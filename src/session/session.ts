/**
 * Core Session representation in Groupy.
 * Manages thread state, conversation history, event bus, and active turn.
 * 
 * Mirrors codex-rs/core/session/session.rs.
 */

import type { ConversationItem } from "../protocol/items";
import type { Event, EventMsg, SessionStatus } from "../protocol/events";
import type { Op, Submission, TurnInputSubmission } from "../protocol/ops";
import { ModelClient } from "../client/model-client";
import { ToolRouter } from "../tools/router";
import type { TurnContext } from "./turn-context";
import { submissionLoop } from "./submission-loop";
import { handleTurnInput } from "./turn-input";

import type { SkillsLoader } from "../skills/loader";
import type { MemoryStore } from "../memories/store";
import type { McpManager } from "../mcp/manager";
import { ExecPolicy } from "../security/exec-policy";

export interface SessionOptions {
  threadId?: string;
  model?: string;
  cwd?: string;
  systemPrompt?: string;
  modelClient?: ModelClient;
  tools?: ToolRouter;
  initialHistory?: ConversationItem[];
  skillsLoader?: SkillsLoader;
  memoryStore?: MemoryStore;
  mcpManager?: McpManager;
  execPolicy?: ExecPolicy;
  collaborationMode?: "default" | "plan" | "review";
  onEvent?: (event: Event) => void;
}

export class Session {
  public readonly threadId: string;
  public model: string;
  public readonly cwd: string;
  public readonly systemPrompt: string;
  public readonly modelClient: ModelClient;
  public readonly tools: ToolRouter;
  public readonly skillsLoader?: SkillsLoader;
  public readonly memoryStore?: MemoryStore;
  public readonly mcpManager?: McpManager;
  public readonly execPolicy: ExecPolicy;
  public collaborationMode: "default" | "plan" | "review" = "default";

  private history: ConversationItem[] = [];
  private activeTurn: TurnContext | null = null;
  private status: SessionStatus = "idle";
  private eventListeners: Array<(event: Event) => void> = [];
  private pendingApprovals = new Map<string, (approved: boolean) => void>();
  private pendingUserQuestions = new Map<string, (answer: string) => void>();

  // Async queue for submissions
  private submissionResolvers: Array<(sub: Submission) => void> = [];
  private submissionQueue: Submission[] = [];
  private isTerminated = false;

  constructor(options: SessionOptions = {}) {
    this.threadId = options.threadId || `thread_${Date.now()}`;
    this.model = options.model || "gpt-4o";
    this.cwd = options.cwd || process.cwd();
    this.systemPrompt = options.systemPrompt || "";
    this.modelClient = options.modelClient || new ModelClient();
    this.tools = options.tools || new ToolRouter();
    this.skillsLoader = options.skillsLoader;
    this.memoryStore = options.memoryStore;
    this.mcpManager = options.mcpManager;
    this.execPolicy = options.execPolicy || new ExecPolicy();
    this.collaborationMode = options.collaborationMode || "default";
    this.history = options.initialHistory ? [...options.initialHistory] : [];

    if (options.onEvent) {
      this.eventListeners.push(options.onEvent);
    }

    // Start background submission loop
    this.startSubmissionLoop();

    this.emitEvent({
      type: "SessionConfigured",
      threadId: this.threadId,
      model: this.model,
    });
  }

  // --- Event Stream Bus ---

  onEvent(listener: (event: Event) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  emitEvent(msg: EventMsg): void {
    if (msg.type === "StatusChanged") {
      this.status = msg.status;
    }

    const event: Event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      msg,
    };

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("Error in event listener:", err);
      }
    }
  }

  // --- State & History ---

  getHistory(): ConversationItem[] {
    return [...this.history];
  }

  setHistory(items: ConversationItem[]): void {
    this.history = [...items];
  }

  addHistoryItem(item: ConversationItem): void {
    this.history.push(item);
  }

  getActiveTurn(): TurnContext | null {
    return this.activeTurn;
  }

  setActiveTurn(turn: TurnContext): void {
    this.activeTurn = turn;
    this.emitEvent({
      type: "StatusChanged",
      status: "running",
    });
  }

  clearActiveTurn(turnId?: string): void {
    if (!turnId || this.activeTurn?.turnId === turnId) {
      this.activeTurn = null;
      this.emitEvent({
        type: "StatusChanged",
        status: "idle",
      });
    }
  }

  interrupt(): void {
    if (this.activeTurn) {
      this.activeTurn.abort("Interrupted by user");
      this.clearActiveTurn();
      this.emitEvent({
        type: "StatusChanged",
        status: "interrupted",
      });
    }
  }

  // --- Approvals Handling ---

  requestApproval(params: {
    approvalId: string;
    turnId: string;
    toolName: string;
    description: string;
    command?: string;
  }): Promise<boolean> {
    this.emitEvent({
      type: "ApprovalRequired",
      approvalId: params.approvalId,
      turnId: params.turnId,
      toolName: params.toolName,
      description: params.description,
      command: params.command,
    });
    this.emitEvent({
      type: "StatusChanged",
      status: "waiting_approval",
    });

    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(params.approvalId, (approved) => {
        this.emitEvent({
          type: "StatusChanged",
          status: "running",
        });
        resolve(approved);
      });
    });
  }

  resolveApproval(approvalId: string, approved: boolean): void {
    const resolver = this.pendingApprovals.get(approvalId);
    if (resolver) {
      this.pendingApprovals.delete(approvalId);
      resolver(approved);
    }
  }

  // --- Interactive Questions / Elicitation Handling ---

  requestUserQuestion(params: {
    questionId: string;
    turnId: string;
    question: string;
    options?: string[];
  }): Promise<string> {
    this.emitEvent({
      type: "UserQuestionRequired",
      questionId: params.questionId,
      turnId: params.turnId,
      question: params.question,
      options: params.options,
    });
    this.emitEvent({
      type: "StatusChanged",
      status: "waiting_user_input",
    });

    return new Promise<string>((resolve) => {
      this.pendingUserQuestions.set(params.questionId, (answer) => {
        this.emitEvent({
          type: "StatusChanged",
          status: "running",
        });
        resolve(answer);
      });
    });
  }

  resolveUserQuestion(questionId: string, answer: string): void {
    const resolver = this.pendingUserQuestions.get(questionId);
    if (resolver) {
      this.pendingUserQuestions.delete(questionId);
      resolver(answer);
    }
  }

  // --- Submission Queue Pipeline ---

  async submit(op: Op): Promise<string> {
    const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const submission: Submission = {
      id: subId,
      op,
      createdAt: Date.now(),
    };

    const resolver = this.submissionResolvers.shift();
    if (resolver) {
      resolver(submission);
    } else {
      this.submissionQueue.push(submission);
    }

    return subId;
  }

  /**
   * Direct high-level prompt helper
   */
  async prompt(text: string, images?: string[]): Promise<TurnInputSubmission> {
    return handleTurnInput(this, { text, images });
  }

  /**
   * Submits a prompt and waits for the entire ReAct turn to complete
   */
  async promptAndWait(text: string, images?: string[], timeoutMs = 30000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Turn timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsub = this.onEvent((event) => {
        if (event.msg.type === "TurnCompleted") {
          clearTimeout(timer);
          unsub();
          resolve();
        } else if (event.msg.type === "Error") {
          clearTimeout(timer);
          unsub();
          reject(new Error(event.msg.message));
        }
      });

      this.prompt(text, images).catch((err) => {
        clearTimeout(timer);
        unsub();
        reject(err);
      });
    });
  }

  private async *createSubmissionIterator(): AsyncIterable<Submission> {
    while (!this.isTerminated) {
      if (this.submissionQueue.length > 0) {
        yield this.submissionQueue.shift()!;
      } else {
        const nextSub = await new Promise<Submission>((resolve) => {
          this.submissionResolvers.push(resolve);
        });
        yield nextSub;
      }
    }
  }

  private startSubmissionLoop(): void {
    const iterator = this.createSubmissionIterator();
    submissionLoop(this, iterator).catch((err) => {
      console.error("Submission loop terminated with error:", err);
    });
  }
}
