import { describe, it, expect } from "bun:test";
import { formatTurnSummary, type TurnSummaryMetrics } from "../src/cli/ui/formatter";
import { parsePatch, renderDiff } from "../src/cli/ui/diff";
import { promptChoice } from "../src/cli/ui/prompt";

describe("CLI UX & Turn Metrics Subsystem", () => {
  it("computes and formats Turn Summary stats accurately", () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg?: any) => {
      output += (msg ?? "") + "\n";
    };

    try {
      const metrics: TurnSummaryMetrics = {
        durationMs: 2450,
        inputTokens: 1200,
        outputTokens: 320,
        contextTokens: 19200,
        maxContextTokens: 128000,
        sessionUptimeMs: 84000, // 1m 24s
        subAgents: [
          { nickname: "Heca", role: "coder", runningTimeMs: 14000, status: "completed" },
          { nickname: "Bankli", role: "reviewer", runningTimeMs: 42000, status: "running" },
        ],
        toolCalls: ["shell", "apply_patch"],
        filesModified: ["src/index.ts"],
      };

      formatTurnSummary(metrics);

      expect(output).toContain("Completed in");
      expect(output).toContain("2.5s");
      expect(output).toContain("1.2k in");
      expect(output).toContain("320 out");
      expect(output).toContain("15% context");
      expect(output).toContain("1m 24s");
      expect(output).toContain("Heca");
      expect(output).toContain("14.0s");
      expect(output).toContain("Bankli");
      expect(output).toContain("42.0s");
      expect(output).toContain("2 tools (shell, apply_patch)");
      expect(output).toContain("1 file updated");
    } finally {
      console.log = originalLog;
    }
  });

  it("formats durations accurately across seconds, minutes, and hours", () => {
    const { formatDuration } = require("../src/cli/ui/spinner");
    expect(formatDuration(4200)).toBe("4.2s");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(3665000)).toBe("1h 1m 5s");
  });

  it("renders intra-line visual diff with word-level changes", () => {
    const oldCode = "const message = 'Hello World';";
    const newCode = "const message = 'Hello Universe';";

    const diffLines = parsePatch(oldCode, newCode);
    expect(diffLines.length).toBeGreaterThan(0);

    const rendered = renderDiff(diffLines, { filePath: "test.ts", termWidth: 80 });
    expect(rendered).toContain("test.ts");
    expect(rendered).toContain("Hello");
  });

  it("fallback non-TTY promptChoice picks the default index when empty", async () => {
    // In automated tests (non-TTY), verify promptChoice resolves safely
    const decision = await promptChoice({
      message: "Confirm action?",
      choices: [
        { key: "y", label: "Yes", value: "yes", isDefault: true },
        { key: "n", label: "No", value: "no" },
      ],
      defaultIndex: 0,
    });

    expect(decision).toBe("yes");
  });

  it("formats Task Step Tree items cleanly for tool runs", () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg?: any) => {
      output += (msg ?? "") + "\n";
    };

    try {
      const { formatTaskStepStart, formatTaskStepFinish } = require("../src/cli/ui/formatter");
      formatTaskStepStart(1, "read_file", { path: "src/cli/repl.ts" });
      formatTaskStepFinish(1, "read_file", { path: "src/cli/repl.ts" }, "line 1\nline 2\nline 3", false);

      expect(output).toContain("⏺");
      expect(output).toContain("read_file");
      expect(output).toContain("⎿");
      expect(output).toContain("3 lines read");
    } finally {
      console.log = originalLog;
    }
  });

  it("finds matching files for @file autocomplete", () => {
    const { FileSearchEngine } = require("../src/search/engine");
    const engine = new FileSearchEngine();
    const matches = engine.findFiles(process.cwd(), { pattern: "formatter", maxResults: 10 });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m: string) => m.includes("formatter"))).toBe(true);
  });
});
