import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EphemeralWorkspaceManager, globalEphemeralWorkspace } from "../src/workspace/ephemeral";
import { createDefaultTools } from "../src/tools";

describe("Ephemeral Workspace & Zero-Pollution Subsystem", () => {
  let testCwd: string;

  beforeEach(() => {
    testCwd = join(tmpdir(), `groupy-cleanliness-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testCwd, { recursive: true });
  });

  afterEach(() => {
    try {
      if (existsSync(testCwd)) {
        rmSync(testCwd, { recursive: true, force: true });
      }
    } catch {}
  });

  it("should create and delete per-command ephemeral scratchpads", () => {
    const manager = new EphemeralWorkspaceManager();
    const scratchpad = manager.createScratchpad("turn_123");

    expect(existsSync(scratchpad)).toBe(true);
    expect(scratchpad).toContain("groupy-ephemeral");

    writeFileSync(join(scratchpad, "temp.log"), "temporary logs", "utf8");
    expect(existsSync(join(scratchpad, "temp.log"))).toBe(true);

    manager.cleanup(scratchpad);
    expect(existsSync(scratchpad)).toBe(false);
  });

  it("should cleanup all turn scratchpads when cleanupTurn is invoked", () => {
    const manager = new EphemeralWorkspaceManager();
    const turnId = `test_turn_${Date.now()}`;
    const p1 = manager.createScratchpad(turnId);
    const p2 = manager.createScratchpad(turnId);

    expect(existsSync(p1)).toBe(true);
    expect(existsSync(p2)).toBe(true);

    manager.cleanupTurn(turnId);
    expect(existsSync(p1)).toBe(false);
    expect(existsSync(p2)).toBe(false);
  });

  it("should scan and clean root residue files matching temp patterns", () => {
    const manager = new EphemeralWorkspaceManager();

    // Legitimate files that must NOT be deleted
    writeFileSync(join(testCwd, "package.json"), "{}", "utf8");
    writeFileSync(join(testCwd, "README.md"), "# Hello", "utf8");
    mkdirSync(join(testCwd, "src"), { recursive: true });
    writeFileSync(join(testCwd, "src", "index.ts"), "export const a = 1;", "utf8");

    // Accidental junk files in root that MUST be cleaned
    writeFileSync(join(testCwd, "tmp_output.json"), "{}", "utf8");
    writeFileSync(join(testCwd, "draft_design.html"), "<h1>draft</h1>", "utf8");
    writeFileSync(join(testCwd, "scratch_test.js"), "console.log(1)", "utf8");
    writeFileSync(join(testCwd, "preview_card.html"), "<div>preview</div>", "utf8");
    writeFileSync(join(testCwd, "temp_data.csv"), "a,b,c", "utf8");
    writeFileSync(join(testCwd, "build.tmp"), "binary", "utf8");

    const cleaned = manager.cleanRootResidue(testCwd);

    expect(cleaned).toContain("tmp_output.json");
    expect(cleaned).toContain("draft_design.html");
    expect(cleaned).toContain("scratch_test.js");
    expect(cleaned).toContain("preview_card.html");
    expect(cleaned).toContain("temp_data.csv");
    expect(cleaned).toContain("build.tmp");

    // Check disk state
    expect(existsSync(join(testCwd, "tmp_output.json"))).toBe(false);
    expect(existsSync(join(testCwd, "draft_design.html"))).toBe(false);
    expect(existsSync(join(testCwd, "package.json"))).toBe(true);
    expect(existsSync(join(testCwd, "README.md"))).toBe(true);
    expect(existsSync(join(testCwd, "src", "index.ts"))).toBe(true);
  });

  it("should inject GROUPY_SCRATCH_DIR and TMPDIR into shell tool executions", async () => {
    const tools = createDefaultTools();
    const result = await tools.execute("shell", {
      command: process.platform === "win32" ? "echo %GROUPY_SCRATCH_DIR%" : "echo $GROUPY_SCRATCH_DIR",
    }, {
      cwd: testCwd,
      turnId: "turn_env_check",
    });

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("groupy-ephemeral");
  });
});
