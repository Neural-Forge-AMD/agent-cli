import { describe, it, expect } from "bun:test";
import { SPINNER_VARIANTS, ClaudeThinkingSpinner, LiveSpinner } from "../src/cli/ui/spinner";
import {
  CliFormatter,
  formatTaskStepStart,
  formatTaskStepFinish,
  formatToolCard,
  formatTaskProgressPlan,
} from "../src/cli/ui/formatter";
import { ClaudeMessage } from "../src/ui/components/claude/claude-message";
import { ClaudeThinking, CLAUDE_GLYPHS, CLAUDE_VERBS } from "../src/ui/components/claude/claude-thinking";
import { ClaudeToolCall } from "../src/ui/components/claude/claude-tool-call";
import { ClaudeTodoList } from "../src/ui/components/claude/claude-todo-list";
import { ClaudeDiff } from "../src/ui/components/claude/claude-diff";
import { ClaudePrompt } from "../src/ui/components/claude/claude-prompt";

describe("Claude Message & Claude Thinking UI Integration", () => {
  it("should define authentic claude_sparkle spinner variant matching brainless specification", () => {
    const variant = SPINNER_VARIANTS.claude_sparkle;
    expect(variant).toBeDefined();
    expect(variant.frames).toEqual(["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"]);
    expect(variant.intervalMs).toBe(110);
  });

  it("should instantiate and manage ClaudeThinkingSpinner lifecycle", () => {
    const spinner = new ClaudeThinkingSpinner();
    expect(spinner.isActive()).toBe(false);

    spinner.start();
    expect(spinner.isActive()).toBe(true);

    spinner.clear();
    expect(spinner.isActive()).toBe(false);
  });

  it("should format Claude Code style user prompt and assistant response in CliFormatter", () => {
    const userPrompt = CliFormatter.formatClaudeUserPrompt("git status and check build");
    expect(userPrompt).toContain("❯");
    expect(userPrompt).toContain("git status and check build");

    const assistantMsg = CliFormatter.formatClaudeAssistantResponse("I'll run the build and inspect the repo.");
    expect(assistantMsg).toContain("I'll run the build and inspect the repo.");

    const userTurn = CliFormatter.formatClaudeMessage("user", "Hello Claude");
    expect(userTurn).toContain("❯");
    expect(userTurn).toContain("Hello Claude");

    const assistantTurn = CliFormatter.formatClaudeMessage("assistant", "Hello human");
    expect(assistantTurn).toContain("Hello human");
  });

  it("should export Claude React components with authentic sparkle glyphs and rotating verbs", () => {
    expect(CLAUDE_GLYPHS.length).toBe(10);
    expect(CLAUDE_GLYPHS).toContain("✳");
    expect(CLAUDE_GLYPHS).toContain("✻");

    expect(CLAUDE_VERBS).toContain("Thinking");
    expect(CLAUDE_VERBS).toContain("Levitating");
    expect(CLAUDE_VERBS).toContain("Schlepping");
    expect(CLAUDE_VERBS).toContain("Herding");
    expect(CLAUDE_VERBS).toContain("Percolating");
    expect(CLAUDE_VERBS).toContain("Noodling");
    expect(CLAUDE_VERBS).toContain("Conjuring");

    expect(typeof ClaudeMessage).toBe("function");
    expect(typeof ClaudeThinking).toBe("function");
    expect(typeof ClaudeToolCall).toBe("function");
    expect(typeof ClaudeTodoList).toBe("function");
    expect(typeof ClaudeDiff).toBe("function");
    expect(typeof ClaudePrompt).toBe("function");
  });

  it("should format task progress plan using Claude todo list grammar (⎿ ✔ / ◼ / ◻)", () => {
    // Should run formatTaskProgressPlan without throwing
    expect(() => {
      formatTaskProgressPlan([
        { step: "Analyze requirements", status: "completed" },
        { step: "Implement component", status: "in_progress" },
        { step: "Run verification tests", status: "pending" },
      ]);
    }).not.toThrow();
  });

  it("should format task steps and diffs using Claude tool call and patch grammar (⏺ / ⎿)", () => {
    expect(() => {
      formatTaskStepStart(1, "Bash", { command: "bun test" });
      formatTaskStepFinish(1, "Bash", { command: "bun test" }, "4 pass\n0 fail");
      formatToolCard("Bash", { command: "bun run build" }, "Build completed");
      CliFormatter.formatPatchDiff("src/index.ts", "const a = 1;", "const a = 2;");
    }).not.toThrow();
  });
});

