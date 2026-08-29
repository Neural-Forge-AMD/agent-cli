/**
 * Interactive Command-Line Interface (REPL) for Groupy.
 * Directly mirrors codex-rs/cli & codex-rs/tui with real-time slash commands popup,
 * turn synchronization, clean thinking spinner (hidden reasoning by default),
 * and streaming markdown syntax highlighting.
 */

import { c, style } from "./ui/colors";
import { LiveSpinner } from "./ui/spinner";
import { renderGroupyBanner, formatToolCard } from "./ui/formatter";
import { handleSlashCommand, AVAILABLE_SLASH_COMMANDS } from "./commands";
import { InteractiveLineEditor } from "./ui/line-editor";
import { MarkdownHighlighter } from "./ui/markdown";
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
          this.currentTurnHasOutput = false;
          this.reasoningStarted = false;
          this.highlighter = new MarkdownHighlighter();
          this.spinner.start("Thinking...");
          break;

        case "ReasoningDelta":
        case "AgentReasoningDelta" as any:
          if (this.showReasoning) {
            if (!this.reasoningStarted) {
              this.spinner.stop();
              console.log(style.dim("\n  ┌── 💭 Thinking ──────────────────────────────────────────"));
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
          console.log();
          formatToolCard(msg.toolName, msg.arguments);
          this.spinner.start(`Executing ${msg.toolName}...`);
          break;

        case "ToolCallFinished":
          this.spinner.stop();
          formatToolCard(msg.toolName, {}, msg.output, msg.isError);
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
          console.log();
          if (msg.totalTokens) {
            console.log(
              style.dim(`[Turn completed | ${msg.totalTokens} tokens]`)
            );
          }
          console.log();
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
    console.log();
    console.log(style.yellow(`[!] Approval Required for action:`));
    console.log(`    Tool: ${style.bold(msg.toolName)}`);
    if (msg.command) {
      console.log(`    Command: ${style.cyan(msg.command)}`);
    }
    console.log(`    Reason: ${style.dim(msg.description)}`);

    try {
      const editor = new InteractiveLineEditor({ promptSymbol: style.bold(`\nAllow execution? [y/N]: `) });
      const answer = (await editor.readLine()).trim().toLowerCase();

      const approved = answer === "y" || answer === "yes";
      this.session.resolveApproval(msg.approvalId, approved);

      if (approved) {
        this.spinner.start(`Executing approved action...`);
      } else {
        console.log(style.dim("Action rejected by user."));
      }
    } catch {
      this.session.resolveApproval(msg.approvalId, false);
    }
  }

  async start(): Promise<void> {
    // 1. Render Groupy Emblem & Banner
    renderGroupyBanner({
      role: this.role,
      model: this.session.model,
      cwd: this.session.cwd,
    });

    const editor = new InteractiveLineEditor({
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
