import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import {
  readFileTool,
  viewFileTool,
  createDefaultTools,
  DEFAULT_MAX_UNPAGINATED_LINES,
} from "../src";

describe("Surgical Precision Tools (Context Window Efficiency)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = resolve(tmpdir(), `groupy-precision-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  });

  test("small file unpaginated read returns exact raw content for backward compatibility", async () => {
    const rawContent = "console.log('line 1');\nconsole.log('line 2');\nconsole.log('line 3');";
    const filePath = join(testDir, "small.ts");
    writeFileSync(filePath, rawContent, "utf8");

    const res = await readFileTool.execute({ path: "small.ts" }, { cwd: testDir, turnId: "t1" });
    expect(res.isError).toBeFalsy();
    expect(res.output).toBe(rawContent);
  });

  test("explicit line range (start_line & end_line) returns 1-indexed numbered lines", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `function fn${i + 1}() { return ${i + 1}; }`);
    const filePath = join(testDir, "functions.ts");
    writeFileSync(filePath, lines.join("\n"), "utf8");

    const res = await readFileTool.execute(
      { path: "functions.ts", start_line: 10, end_line: 15 },
      { cwd: testDir, turnId: "t1" }
    );

    expect(res.isError).toBeFalsy();
    expect(res.output).toContain("[Showing lines 10 to 15 of 50 in 'functions.ts']");
    expect(res.output).toContain("10: function fn10() { return 10; }");
    expect(res.output).toContain("15: function fn15() { return 15; }");
    expect(res.output).not.toContain("9: function fn9");
    expect(res.output).not.toContain("16: function fn16");
    expect(res.output).toContain("[File has 50 lines. To read further, use start_line=16.]");
  });

  test("offset and limit parameters work as aliases for start_line and end_line", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `const val_${i + 1} = ${i + 1};`);
    const filePath = join(testDir, "values.ts");
    writeFileSync(filePath, lines.join("\n"), "utf8");

    const res = await readFileTool.execute(
      { path: "values.ts", offset: 5, limit: 3 },
      { cwd: testDir, turnId: "t1" }
    );

    expect(res.isError).toBeFalsy();
    expect(res.output).toContain("[Showing lines 5 to 7 of 30 in 'values.ts']");
    expect(res.output).toContain("5: const val_5 = 5;");
    expect(res.output).toContain("6: const val_6 = 6;");
    expect(res.output).toContain("7: const val_7 = 7;");
  });

  test("large file (> 250 lines) unpaginated read auto-truncates to protect context window", async () => {
    const totalLines = 300;
    const lines = Array.from({ length: totalLines }, (_, i) => `export const item_${i + 1} = ${i + 1};`);
    const filePath = join(testDir, "large.ts");
    writeFileSync(filePath, lines.join("\n"), "utf8");

    const res = await readFileTool.execute({ path: "large.ts" }, { cwd: testDir, turnId: "t1" });

    expect(res.isError).toBeFalsy();
    expect(res.output).toContain(`[Showing lines 1 to ${DEFAULT_MAX_UNPAGINATED_LINES} of ${totalLines} in 'large.ts']`);
    expect(res.output).toContain("1: export const item_1 = 1;");
    expect(res.output).toContain(`250: export const item_250 = 250;`);
    expect(res.output).toContain(`[Truncated: 50 more lines. Use start_line=251 to continue reading.]`);
    expect(res.output).not.toContain("item_251");
  });

  test("validates boundary errors cleanly", async () => {
    const filePath = join(testDir, "bounds.ts");
    writeFileSync(filePath, "line 1\nline 2\nline 3\n", "utf8");

    // start_line beyond total lines
    const res1 = await readFileTool.execute(
      { path: "bounds.ts", start_line: 50 },
      { cwd: testDir, turnId: "t1" }
    );
    expect(res1.isError).toBe(true);
    expect(res1.output).toContain("exceeds total lines");

    // end_line < start_line
    const res2 = await readFileTool.execute(
      { path: "bounds.ts", start_line: 3, end_line: 1 },
      { cwd: testDir, turnId: "t1" }
    );
    expect(res2.isError).toBe(true);
    expect(res2.output).toContain("cannot be less than start_line");
  });

  test("view_file and find_by_name aliases execute seamlessly via ToolRouter", async () => {
    const router = createDefaultTools();
    expect(router.has("view_file")).toBe(true);
    expect(router.has("find_by_name")).toBe(true);

    const filePath = join(testDir, "test-view.ts");
    writeFileSync(filePath, "const greeting = 'hello from view_file';\n", "utf8");

    // Execute view_file
    const viewRes = await router.execute(
      "view_file",
      { path: "test-view.ts" },
      { cwd: testDir, turnId: "t1" }
    );
    expect(viewRes.isError).toBeFalsy();
    expect(viewRes.output).toContain("hello from view_file");

    // Execute find_by_name
    const findRes = await router.execute(
      "find_by_name",
      { pattern: "*.ts" },
      { cwd: testDir, turnId: "t1" }
    );
    expect(findRes.isError).toBeFalsy();
    expect(findRes.output).toContain("test-view.ts");
  });
});
