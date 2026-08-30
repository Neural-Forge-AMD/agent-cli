/**
 * Interactive Command-Line Interface (REPL) for Groupy.
 * Directly mirrors codex-rs/cli & codex-rs/tui with real-time slash commands popup,
 * turn synchronization, clean thinking spinner (hidden reasoning by default),
 * and streaming markdown syntax highlighting.
 */

import { c, style } from "./ui/colors";
import { LiveSpinner } from "./ui/spinner";
import {
  renderGroupyBanner,
  formatToolCard,
  formatTurnSummary,
  formatTaskStepStart,
  formatTaskStepFinish,
} from "./ui/formatter";
import { handleSlashCommand, AVAILABLE_SLASH_COMMANDS } from "./commands";
import { InteractiveLineEditor } from "./ui/line-editor";
import { promptToolApproval } from "./ui/prompt";
import { MarkdownHighlighter } from "./ui/markdown";
import { CredentialsStore } from "../auth/store";
import type { Session } from "../session/session";
import type { AgentSpawner } from "../agents/spawner";
import type { McpManager } from "../mcp/manager";
import type { SessionPersistenceManager } from "../storage/manager";
import type { SkillsLoader } from "../skills/loader";
import type { MemoryStore } from "../memories/store";
import type { WorktreeManager } from "../worktree/manager";

export interface ReplOptions {
  session: Session;
  spawner?: AgentSpawner;
  mcpManager?: McpManager;
  storageManager?: SessionPersistenceManager;
  skillsLoader?: SkillsLoader;
  memoryStore?: MemoryStore;
  worktreeManager?: WorktreeManager;
  role?: string;
  showReasoning?: boolean;
}

export class CliRepl {
  public showReasoning = false;
  public readonly sessionStartTime = Date.now();
  public turnCount = 0;

  private session: Session;
  private spawner?: AgentSpawner;
  private mcpManager?: McpManager;
  private storageManager?: SessionPersistenceManager;
  private skillsLoader?: SkillsLoader;
  private memoryStore?: MemoryStore;
  private worktreeManager?: WorktreeManager;
  private role: string;
  private spinner = new LiveSpinner();
  private isProcessing = false;
  private currentTurnHasOutput = false;
  private reasoningStarted = false;
  private isClosed = false;
  private highlighter = new MarkdownHighlighter();
  private turnDoneResolver?: () => void;

  // Turn Metrics Tracking
  private turnStartTime = 0;
  private turnToolCalls: string[] = [];
  private turnFilesModified = new Set<string>();
  private turnCharsOut = 0;
  private activeToolArgs: Record<string, unknown> = {};

  constructor(options: ReplOptions) {
    this.session = options.session;
    this.spawner = options.spawner;
    this.mcpManager = options.mcpManager;
    this.storageManager = options.storageManager;
    this.skillsLoader = options.skillsLoader || options.session.skillsLoader;
    this.memoryStore = options.memoryStore || options.session.memoryStore;
    this.worktreeManager = options.worktreeManager;
    this.role = options.role || "default";
    this.showReasoning = options.showReasoning ?? false;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    this.session.onEvent(async (event) => {
      const msg = event.msg;

      switch (msg.type) {
        case "TurnStarted":
          this.isProcessing = true;
          this.turnCount++;
          this.currentTurnHasOutput = false;
          this.reasoningStarted = false;
          this.turnStartTime = performance.now();
          this.turnToolCalls = [];
          this.turnFilesModified.clear();
          this.turnCharsOut = 0;
          this.spinner.start("Thinking...");
          break;

        case "ReasoningDelta":
        case "AgentReasoningDelta" as any:
          if (this.showReasoning) {
            if (!this.reasoningStarted) {
              this.spinner.stop();
              console.log(style.dim("\n  ┌──  Thinking ──────────────────────────────────────────"));
              this.reasoningStarted = true;
            }
            process.stdout.write(style.dim((msg as any).delta));
          } else {
            // Keep reasoning hidden inside spinner indicator
            this.spinner.setText("Thinking deeply...");
          }
          break;

        case "AgentMessageDelta":
          if (this.reasoningStarted) {
            console.log(style.dim("\n  └─────────────────────────────────────────────────────────\n"));
            this.reasoningStarted = false;
          }
          if (!this.currentTurnHasOutput && msg.delta.trim().length > 0) {
            this.spinner.stop();
            this.currentTurnHasOutput = true;
          }
          this.turnCharsOut += msg.delta.length;
          if (this.currentTurnHasOutput) {
            const formatted = this.highlighter.feed(msg.delta);
            if (formatted) {
              process.stdout.write(formatted);
            }
          }
          break;

        case "ToolCallStarted":
          if (this.reasoningStarted) {
            console.log(style.dim("\n  └─────────────────────────────────────────────────────────\n"));
            this.reasoningStarted = false;
          }
          this.spinner.stop();
          this.turnToolCalls.push(msg.toolName);
          this.activeToolArgs = msg.arguments || {};
          if (
            (msg.toolName === "apply_patch" || msg.toolName === "write_file") &&
            msg.arguments &&
            typeof (msg.arguments as any).path === "string"
          ) {
            this.turnFilesModified.add((msg.arguments as any).path);
          }
          console.log();
          formatTaskStepStart(this.turnToolCalls.length, msg.toolName, msg.arguments);
          this.spinner.start(`Executing [${this.turnToolCalls.length}] ${msg.toolName}...`);
          break;

        case "ToolCallFinished":
          this.spinner.stop();
          formatTaskStepFinish(
            this.turnToolCalls.length,
            msg.toolName,
            this.activeToolArgs,
            msg.output,
            msg.isError
          );
          break;

        case "InteractiveApprovalRequired" as any:
        case "ApprovalRequired":
          this.spinner.stop();
          await this.handleInteractiveApproval(msg as any);
          break;

        case "TurnCompleted":
          if (this.reasoningStarted) {
            console.log(style.dim("\n  └─────────────────────────────────────────────────────────\n"));
            this.reasoningStarted = false;
          }
          this.spinner.stop();
          const flushed = this.highlighter.flush();
          if (flushed) {
            process.stdout.write(flushed);
          }
          this.isProcessing = false;

          // Render Claude-style Turn Summary Bar with Stats & Metrics
          const durationMs = this.turnStartTime > 0 ? performance.now() - this.turnStartTime : 0;
          const sessionUptimeMs = Date.now() - this.sessionStartTime;
          const subAgents = this.spawner?.listAgents().map((a) => ({
            nickname: a.nickname,
            role: a.role,
            status: a.status,
            runningTimeMs: Date.now() - a.createdAt,
          }));

          formatTurnSummary({
            durationMs,
            inputTokens: msg.inputTokens,
            outputTokens: msg.outputTokens || (this.turnCharsOut > 0 ? Math.round(this.turnCharsOut / 3.8) : undefined),
            totalTokens: msg.totalTokens,
            contextTokens: msg.contextTokens,
            maxContextTokens: msg.maxContextTokens,
            sessionUptimeMs,
            subAgents,
            toolCalls: this.turnToolCalls,
            filesModified: Array.from(this.turnFilesModified),
          });

          if (this.turnDoneResolver) {
            const resolve = this.turnDoneResolver;
            this.turnDoneResolver = undefined;
            resolve();
          }
          break;

        case "Error":
          if (this.reasoningStarted) {
            console.log(style.dim("\n  └─────────────────────────────────────────────────────────\n"));
            this.reasoningStarted = false;
          }
          this.spinner.stop();
          this.isProcessing = false;
          console.log();
          console.error(style.red(`Error: ${msg.message}\n`));
          if (this.turnDoneResolver) {
            const resolve = this.turnDoneResolver;
            this.turnDoneResolver = undefined;
            resolve();
          }
          break;
      }
    });
  }

  private async handleInteractiveApproval(msg: {
    approvalId: string;
    toolName: string;
    description: string;
    command?: string;
  }): Promise<void> {
    try {
      const decision = await promptToolApproval(msg);

      if (decision === "always") {
        this.session.execPolicy.addRule(/.*/, "allow", "User allowed all actions for this session");
        this.session.resolveApproval(msg.approvalId, true);
        this.spinner.start(`Executing approved action (auto-approved for session)...`);
      } else if (decision === "yes") {
        this.session.resolveApproval(msg.approvalId, true);
        this.spinner.start(`Executing approved action...`);
      } else {
        this.session.resolveApproval(msg.approvalId, false);
        console.log(style.dim("  Action rejected by user."));
      }
    } catch {
      this.session.resolveApproval(msg.approvalId, false);
    }
  }

  async start(): Promise<void> {
    // 1. Render Groupy Emblem & Banner
    const creds = new CredentialsStore().load();
    const accountUser = creds?.user?.username || creds?.user?.email || (creds?.accessToken ? "Authenticated" : undefined);

    renderGroupyBanner({
      user: accountUser,
      role: this.role,
      model: this.session.model,
      cwd: this.session.cwd,
    });

    const editor = new InteractiveLineEditor({
      cwd: this.session.cwd,
      onInterrupt: () => {
        if (this.isProcessing) {
          const activeTurn = this.session.getActiveTurn();
          if (activeTurn) {
            activeTurn.abort("Interrupted via Ctrl+C");
            this.spinner.stop();
            console.log(style.yellow("\n[Turn interrupted]\n"));
            this.isProcessing = false;
            if (this.turnDoneResolver) {
              const resolve = this.turnDoneResolver;
              this.turnDoneResolver = undefined;
              resolve();
            }
          }
        }
      },
    });

    while (!this.isClosed) {
      let rawLine: string;
      try {
        rawLine = await editor.readLine();
      } catch {
        break;
      }

      const line = rawLine.trim();
      if (!line) continue;

      // Handle Slash Commands
      if (line.startsWith("/")) {
        const handled = await handleSlashCommand(line, {
          session: this.session,
          spawner: this.spawner,
          mcpManager: this.mcpManager,
          storageManager: this.storageManager,
          skillsLoader: this.skillsLoader,
          memoryStore: this.memoryStore,
          worktreeManager: this.worktreeManager,
          repl: this,
        });

        if (handled) {
          continue;
        }
      }

      // Submit user prompt to Session and wait for completion
      try {
        const turnPromise = new Promise<void>((resolve) => {
          this.turnDoneResolver = resolve;
        });

        await this.session.submit({
          type: "TurnInput",
          request: {
            text: line,
          },
        });

        // Await turn completion before rendering the next prompt symbol!
        await turnPromise;
      } catch (err) {
        console.error(style.red(`Failed to submit turn: ${err instanceof Error ? err.message : String(err)}\n`));
      }
    }
  }
}
