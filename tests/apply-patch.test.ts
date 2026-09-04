import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, unlinkSync, readFileSync, rmdirSync } from "node:fs";
import { resolve } from "node:path";
import { applyPatchTool } from "../src/tools/handlers/apply-patch";

const testDir = resolve(import.meta.dir, "temp_patch_test");

afterEach(() => {
  try {
    const { rmSync } = require("node:fs");
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {}
});

describe("apply_patch Tool Handler", () => {
  test("creates a new file when it does not exist", async () => {
    const filePath = "temp_patch_test/test.txt";
    const result = await applyPatchTool.execute(
      {
        path: filePath,
        replacementContent: "function hello() {\n  return 'world';\n}\n",
      },
      { cwd: import.meta.dir, turnId: "test_turn" }
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("Successfully created new file");

    const fullPath = resolve(import.meta.dir, filePath);
    expect(existsSync(fullPath)).toBe(true);
    expect(readFileSync(fullPath, "utf8")).toBe("function hello() {\n  return 'world';\n}\n");
  });

  test("surgically replaces targeted lines in an existing file", async () => {
    const filePath = "temp_patch_test/test.txt";
    // Setup file
    await applyPatchTool.execute(
      {
        path: filePath,
        replacementContent: "const a = 1;\nconst b = 2;\nconst c = 3;\n",
      },
      { cwd: import.meta.dir, turnId: "test_turn" }
    );

    // Apply patch
    const patchResult = await applyPatchTool.execute(
      {
        path: filePath,
        targetContent: "const b = 2;",
        replacementContent: "const b = 42;",
      },
      { cwd: import.meta.dir, turnId: "test_turn" }
    );

    expect(patchResult.isError).toBeFalsy();
    const fullPath = resolve(import.meta.dir, filePath);
    expect(readFileSync(fullPath, "utf8")).toBe("const a = 1;\nconst b = 42;\nconst c = 3;\n");
  });

  test("fails gracefully when targetContent is not found", async () => {
    const filePath = "temp_patch_test/test.txt";
    await applyPatchTool.execute(
      {
        path: filePath,
        replacementContent: "const x = 100;\n",
      },
      { cwd: import.meta.dir, turnId: "test_turn" }
    );

    const result = await applyPatchTool.execute(
      {
        path: filePath,
        targetContent: "const non_existent = 999;",
        replacementContent: "const updated = 1;",
      },
      { cwd: import.meta.dir, turnId: "test_turn" }
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("targetContent was not found");
  });

  test("seamlessly matches and patches files with Windows CRLF line endings using LF targetContent", async () => {
    const filePath = "temp_patch_test/test_crlf.txt";
    // Setup file with explicit Windows CRLF line endings
    const fullPath = resolve(import.meta.dir, filePath);
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "function test() {\r\n  const x = 1;\r\n  return x;\r\n}\r\n", "utf8");

    // Apply patch where LLM provided Unix LF (\n)
    const patchResult = await applyPatchTool.execute(
      {
        path: filePath,
        targetContent: "  const x = 1;\n  return x;",
        replacementContent: "  const x = 100;\n  return x * 2;",
      },
      { cwd: import.meta.dir, turnId: "test_turn" }
    );

    expect(patchResult.isError).toBeFalsy();
    expect(patchResult.output).toContain("Successfully applied patch");

    // Must preserve Windows CRLF line endings on disk
    const updated = readFileSync(fullPath, "utf8");
    expect(updated).toBe("function test() {\r\n  const x = 100;\r\n  return x * 2;\r\n}\r\n");
  });
});
