import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import {
  FileSearchEngine,
  createFileSearchTools,
  ToolRouter,
} from "../src";

describe("File Search & Grep Subsystem", () => {
  let testDir: string;
  let engine: FileSearchEngine;

  beforeEach(() => {
    testDir = resolve(tmpdir(), `groupy-search-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(testDir, { recursive: true });

    // Scaffold sample directory structure
    const srcDir = join(testDir, "src");
    const testSubDir = join(testDir, "tests");
    const nodeModules = join(testDir, "node_modules", "some-pkg");

    mkdirSync(srcDir, { recursive: true });
    mkdirSync(testSubDir, { recursive: true });
    mkdirSync(nodeModules, { recursive: true });

    writeFileSync(
      join(srcDir, "index.ts"),
      `export const APP_NAME = "GroupyEngine";\nexport function run() {\n  console.log("Starting server...");\n}\n`
    );

    writeFileSync(
      join(srcDir, "utils.ts"),
      `export function calculateMetrics(a: number, b: number) {\n  return a + b;\n}\n`
    );

    writeFileSync(
      join(testSubDir, "app.test.ts"),
      `import { APP_NAME } from "../src/index";\n\ndescribe("app", () => {\n  test("name matches", () => {\n    expect(APP_NAME).toBe("GroupyEngine");\n  });\n});\n`
    );

    // File in ignored directory
    writeFileSync(
      join(nodeModules, "index.js"),
      `export const APP_NAME = "ShouldBeIgnored";\n`
    );

    engine = new FileSearchEngine();
  });

  afterEach(() => {
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  });

  test("greps text pattern across files and respects ignored directories and .gitignore", () => {
    // Add custom gitignore
    writeFileSync(join(testDir, ".gitignore"), "custom_ignored/\n*.secret.ts\n");
    const customIgnoredDir = join(testDir, "custom_ignored");
    mkdirSync(customIgnoredDir, { recursive: true });
    writeFileSync(join(customIgnoredDir, "file.ts"), `export const APP_NAME = "IgnoredByGitignore";\n`);
    writeFileSync(join(testDir, "src", "token.secret.ts"), `export const APP_NAME = "SecretToken";\n`);

    const result = engine.grep(testDir, {
      query: "APP_NAME",
    });

    expect(result.matches.length).toBe(3);
    expect(result.matches.some((m) => m.file.includes("index.ts"))).toBe(true);
    expect(result.matches.some((m) => m.file.includes("app.test.ts"))).toBe(true);
    expect(result.matches.some((m) => m.file.includes("node_modules"))).toBe(false);
    expect(result.matches.some((m) => m.file.includes("custom_ignored"))).toBe(false);
  });

  test("greps with regular expressions and case sensitivity", () => {
    // Regex search
    const regexResult = engine.grep(testDir, {
      query: "calculate[A-Z]\\w+",
      isRegex: true,
    });
    expect(regexResult.matches.length).toBe(1);
    expect(regexResult.matches[0]?.file).toBe("src/utils.ts");
    expect(regexResult.matches[0]?.lineNumber).toBe(1);

    // Case sensitive search
    const caseResult = engine.grep(testDir, {
      query: "groupyengine",
      caseSensitive: true,
    });
    expect(caseResult.matches.length).toBe(0);

    const caseInsensitiveResult = engine.grep(testDir, {
      query: "groupyengine",
      caseSensitive: false,
    });
    expect(caseInsensitiveResult.matches.length).toBe(2);
  });

  test("finds files matching glob patterns", () => {
    const tsFiles = engine.findFiles(testDir, {
      pattern: "*.ts",
    });
    expect(tsFiles.length).toBe(3);
    expect(tsFiles.some((f) => f.includes("node_modules"))).toBe(false);

    const testFiles = engine.findFiles(testDir, {
      pattern: "*test*",
    });
    expect(testFiles.length).toBe(1);
    expect(testFiles[0]).toBe("tests/app.test.ts");
  });

  test("LLM tools (grep_search, find_files) execute cleanly via ToolRouter", async () => {
    const router = new ToolRouter();
    for (const tool of createFileSearchTools(engine)) {
      router.register(tool);
    }

    // 1. Test grep_search tool
    const grepRes = await router.execute(
      "grep_search",
      { query: "calculateMetrics" },
      { cwd: testDir, turnId: "t1" }
    );
    expect(grepRes.isError).toBeFalsy();
    expect(grepRes.output).toContain("src/utils.ts:1:");
    expect(grepRes.output).toContain("export function calculateMetrics");

    // 2. Test find_files tool
    const findRes = await router.execute(
      "find_files",
      { pattern: "*.test.ts" },
      { cwd: testDir, turnId: "t1" }
    );
    expect(findRes.isError).toBeFalsy();
    expect(findRes.output).toContain("Found 1 file(s):");
    expect(findRes.output).toContain("tests/app.test.ts");
  });
});
