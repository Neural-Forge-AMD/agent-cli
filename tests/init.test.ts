import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectAnalyzer } from "../src/init/project-analyzer";
import { runProjectInit } from "../src/init/init-command";
import { handleSlashCommand, type CommandContext } from "../src/cli/commands";
import { Session } from "../src/session/session";
import { ToolRouter } from "../src/tools/router";

describe("Project Initialization & Onboarding Subsystem (/init)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "pikaa-init-test-"));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test("ProjectAnalyzer scans Node/TypeScript project and detects commands & frameworks", () => {
    // Create mock package.json
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "my-awesome-app",
        description: "A super fast fullstack application",
        type: "module",
        scripts: {
          build: "bun run build",
          test: "bun test",
          typecheck: "tsc --noEmit",
          lint: "eslint .",
          dev: "bun run dev",
        },
        dependencies: {
          react: "^19.0.0",
          next: "^15.0.0",
          tailwindcss: "^4.0.0",
        },
      })
    );

    // Create mock tsconfig.json
    writeFileSync(
      join(testDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
        },
      })
    );

    // Create directories
    mkdirSync(join(testDir, "src"));
    mkdirSync(join(testDir, "tests"));

    const analyzer = new ProjectAnalyzer(testDir);
    const analysis = analyzer.analyze();

    expect(analysis.projectName).toBe("my-awesome-app");
    expect(analysis.description).toBe("A super fast fullstack application");
    expect(analysis.languages).toContain("TypeScript");
    expect(analysis.frameworks).toContain("React");
    expect(analysis.frameworks).toContain("Next.js");
    expect(analysis.frameworks).toContain("TailwindCSS");
    expect(analysis.commands.build).toBe("npm run build");
    expect(analysis.commands.test).toBe("bun test");
    expect(analysis.commands.typecheck).toBe("npm run typecheck");
    expect(analysis.directoryStructure["src/"]).toBeDefined();
    expect(analysis.directoryStructure["tests/"]).toBeDefined();
  });

  test("ProjectAnalyzer generates formatted AGENTS.md document", () => {
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "@org/sample-service",
        description: "Sample microservice",
        scripts: {
          test: "bun test",
          build: "bun build ./src/index.ts",
        },
      })
    );

    mkdirSync(join(testDir, "src"));

    const analyzer = new ProjectAnalyzer(testDir);
    const analysis = analyzer.analyze();
    const markdown = analyzer.generateAgentsMarkdown(analysis);

    expect(markdown).toContain("# sample-service");
    expect(markdown).toContain("Sample microservice");
    expect(markdown).toContain("## Development Commands");
    expect(markdown).toContain("- **Build**: `npm run build`");
    expect(markdown).toContain("- **Test**: `bun test`");
    expect(markdown).toContain("## Architecture & Directory Structure");
    expect(markdown).toContain("`src/`");
    expect(markdown).toContain("## Code Style & Guidelines");
  });

  test("runProjectInit writes AGENTS.md to disk cleanly", () => {
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "test-init-repo",
        scripts: {
          test: "bun test",
        },
      })
    );

    const result = runProjectInit({ cwd: testDir });
    expect(result.success).toBe(true);
    expect(result.overwritten).toBe(false);
    expect(existsSync(result.filePath)).toBe(true);

    const savedContent = readFileSync(result.filePath, "utf8");
    expect(savedContent).toContain("# test-init-repo");

    // Second run should report overwritten: true
    const result2 = runProjectInit({ cwd: testDir });
    expect(result2.success).toBe(true);
    expect(result2.overwritten).toBe(true);
  });

  test("handleSlashCommand executes /init in REPL session", async () => {
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "repl-init-project",
        scripts: {
          build: "bun build",
        },
      })
    );

    const session = new Session({
      cwd: testDir,
      tools: new ToolRouter(),
    });

    const ctx: CommandContext = {
      session,
    };

    const handled = await handleSlashCommand("/init", ctx);
    expect(handled).toBe(true);
    expect(existsSync(join(testDir, "AGENTS.md"))).toBe(true);
  });
});
