import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import {
  createDefaultTools,
  CodeModeRuntime,
  ToolRouter,
} from "../src";

describe("Code-Mode Batch Execution Sandbox", () => {
  let testDir: string;
  let router: ToolRouter;
  let runtime: CodeModeRuntime;

  beforeEach(() => {
    testDir = resolve(tmpdir(), `groupy-codemode-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(testDir, { recursive: true });

    router = createDefaultTools();
    runtime = new CodeModeRuntime(router);
  });

  afterEach(() => {
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  });

  test("batches multiple file writes, reads, and searches in a single script execution", async () => {
    const script = `
      // 1. Batch create 3 files
      await tools.writeFile({ path: "file_a.txt", content: "Alpha content with keyword FOO" });
      await tools.writeFile({ path: "file_b.txt", content: "Beta content with keyword BAR" });
      await tools.writeFile({ path: "file_c.txt", content: "Gamma content with keyword FOO" });

      // 2. Read one file back
      const readA = await tools.readFile({ path: "file_a.txt" });
      text("Read file_a: " + readA);

      // 3. Search for FOO across workspace
      const searchRes = await tools.grepSearch({ query: "FOO" });
      text("Search results:\\n" + searchRes);

      return { totalWritten: 3, verified: true };
    `;

    const result = await runtime.execute(
      { code: script },
      { cwd: testDir, turnId: "turn_code_mode_1" }
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Read file_a: Alpha content with keyword FOO");
    expect(result.output).toContain("Search results:");
    expect(result.output).toContain("file_a.txt");
    expect(result.output).toContain("file_c.txt");
    expect(result.output).toContain('"totalWritten": 3');

    // Verify files on disk
    expect(existsSync(join(testDir, "file_a.txt"))).toBe(true);
    expect(existsSync(join(testDir, "file_b.txt"))).toBe(true);
    expect(existsSync(join(testDir, "file_c.txt"))).toBe(true);
  });

  test("supports session key-value storage and console.log helpers", async () => {
    const script = `
      store("last_user", "developer_alice");
      const user = load("last_user");
      console.log("Current user:", user);
      text("Status: OK");
    `;

    const result = await runtime.execute(
      { code: script },
      { cwd: testDir, turnId: "turn_code_mode_2" }
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Current user: developer_alice");
    expect(result.output).toContain("Status: OK");
  });

  test("handles script errors gracefully without crashing the engine", async () => {
    const brokenScript = `
      await tools.nonExistentTool({ arg: 123 });
    `;

    const result = await runtime.execute(
      { code: brokenScript },
      { cwd: testDir, turnId: "turn_code_mode_3" }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("is not registered in ToolRouter");
    expect(result.output).toContain("[Execution Error]");
  });

  test("executes code_mode LLM tool via ToolRouter", async () => {
    const toolCall = await router.execute(
      "code_mode",
      {
        code: `
          await tools.writeFile({ path: "tool_test.json", content: JSON.stringify({ ok: true }) });
          const content = await tools.readFile({ path: "tool_test.json" });
          text("Loaded content: " + content);
        `,
      },
      { cwd: testDir, turnId: "turn_code_mode_4" }
    );

    expect(toolCall.isError).toBeFalsy();
    expect(toolCall.output).toContain("Loaded content: {\"ok\":true}");
    expect(existsSync(join(testDir, "tool_test.json"))).toBe(true);
  });

  test("auto-transforms accidental ESM import statements from LLM into tools calls", async () => {
    const toolCall = await router.execute(
      "code_mode",
      {
        code: `
          import { write_file, read_file } from "tools";
          await write_file({ path: "esm_test.txt", content: "hello from esm" });
          const content = await read_file({ path: "esm_test.txt" });
          text("ESM Read: " + content);
        `,
      },
      { cwd: testDir, turnId: "turn_code_mode_5" }
    );

    expect(toolCall.isError).toBeFalsy();
    expect(toolCall.output).toContain("ESM Read: hello from esm");
  });
});
