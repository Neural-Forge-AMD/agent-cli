/**
 * Automated Self-Verification Engine.
 * Automatically runs typechecks, linter checks, and targeted test runners
 * scoped to modified files whenever an agent mutates code during a turn.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectAnalyzer } from "../init/project-analyzer";
import type { AutoVerifierOptions, VerificationResult } from "./types";

export class AutoVerifier {
  private cwd: string;
  private customCommand?: string;
  private timeoutMs: number;

  constructor(options: AutoVerifierOptions) {
    this.cwd = options.cwd;
    this.customCommand = options.customCommand;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  /**
   * Discovers existing test files on disk that directly match or correspond to modified source files.
   */
  public findTargetedTests(modifiedFiles: string[] = []): string[] {
    const matchedTests = new Set<string>();

    for (const rawFile of modifiedFiles) {
      const normalized = rawFile.replace(/\\/g, "/").replace(/^\.\//, "");

      // Case 1: The modified file itself is a test file
      if (
        /\.(test|spec)\.[jt]sx?$/i.test(normalized) ||
        /(^|\/)test_[^/]+\.py$/i.test(normalized) ||
        /_test\.py$/i.test(normalized) ||
        /_test\.go$/i.test(normalized)
      ) {
        if (existsSync(join(this.cwd, normalized))) {
          matchedTests.add(normalized);
        }
        continue;
      }

      // Case 2: The modified file is source code; locate corresponding test files
      const extMatch = normalized.match(/\.[^.]+$/);
      if (!extMatch) continue;
      const withoutExt = normalized.slice(0, -extMatch[0].length);
      const parts = withoutExt.split("/");
      const baseName = parts[parts.length - 1]!;

      // Strip common source directory prefixes like src/ or lib/
      const subPath = normalized.startsWith("src/")
        ? normalized.slice(4, -extMatch[0].length)
        : normalized.startsWith("lib/")
        ? normalized.slice(4, -extMatch[0].length)
        : withoutExt;

      const candidatePaths = [
        `tests/${subPath}.test.ts`,
        `tests/${subPath}.test.js`,
        `tests/${subPath}.test.tsx`,
        `tests/${subPath}.spec.ts`,
        `tests/${subPath}.spec.js`,
        `tests/${baseName}.test.ts`,
        `tests/${baseName}.test.js`,
        `tests/${baseName}.spec.ts`,
        `test/${subPath}.test.ts`,
        `test/${subPath}.test.js`,
        `test/${baseName}.test.ts`,
        `test/${baseName}.test.js`,
        `src/${subPath}.test.ts`,
        `src/${subPath}.spec.ts`,
        `${withoutExt}.test.ts`,
        `${withoutExt}.spec.ts`,
        `tests/test_${baseName}.py`,
        `test_${baseName}.py`,
        `tests/${baseName}_test.go`,
      ];

      for (const candidate of candidatePaths) {
        if (existsSync(join(this.cwd, candidate))) {
          matchedTests.add(candidate);
        }
      }
    }

    return Array.from(matchedTests);
  }

  /**
   * Resolves a targeted test execution command scoped specifically to matching test files.
   */
  public resolveTargetedTestCommand(testFiles: string[]): string | null {
    if (testFiles.length === 0) return null;

    const quotedFiles = testFiles.map((f) => (f.includes(" ") ? `"${f}"` : f)).join(" ");

    // 1. Check for Bun runtime
    if (existsSync(join(this.cwd, "bun.lockb")) || existsSync(join(this.cwd, "bun.lock"))) {
      return `bun test ${quotedFiles}`;
    }

    // 2. Check package.json scripts / devDependencies
    const pkgPath = join(this.cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8").replace(/^\uFEFF/, ""));
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

        if (allDeps.vitest) {
          return `npx vitest run ${quotedFiles}`;
        }
        if (allDeps.jest) {
          return `npx jest ${quotedFiles}`;
        }

        const pm = existsSync(join(this.cwd, "pnpm-lock.yaml"))
          ? "pnpm"
          : existsSync(join(this.cwd, "yarn.lock"))
          ? "yarn"
          : "npm";

        if (pkg.scripts?.test) {
          if (pkg.scripts.test.includes("bun test")) {
            return `bun test ${quotedFiles}`;
          }
          return `${pm} test -- ${quotedFiles}`;
        }
      } catch (err) {
        console.warn(`[AutoVerifier] Failed to parse package.json for test runner:`, err);
      }
    }

    // 3. Python project
    if (existsSync(join(this.cwd, "pyproject.toml")) || existsSync(join(this.cwd, "requirements.txt"))) {
      if (existsSync(join(this.cwd, "uv.lock"))) {
        return `uv run pytest ${quotedFiles}`;
      }
      return `pytest ${quotedFiles}`;
    }

    // 4. Go project
    if (existsSync(join(this.cwd, "go.mod"))) {
      return `go test ${quotedFiles}`;
    }

    // 5. Rust project
    if (existsSync(join(this.cwd, "Cargo.toml"))) {
      return `cargo test ${quotedFiles}`;
    }

    return null;
  }

  /**
   * Resolves the static check command (typecheck or compilation check) if available.
   */
  public resolveStaticCommand(): string | null {
    try {
      const analyzer = new ProjectAnalyzer(this.cwd);
      const analysis = analyzer.analyze();
      if (analysis.commands.typecheck) {
        return analysis.commands.typecheck;
      }
    } catch (err) {
      console.warn(`[AutoVerifier] ProjectAnalyzer analysis error:`, err);
    }

    const pkgPath = join(this.cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8").replace(/^\uFEFF/, ""));
        if (pkg.scripts) {
          const pm = existsSync(join(this.cwd, "bun.lockb")) || existsSync(join(this.cwd, "bun.lock"))
            ? "bun"
            : existsSync(join(this.cwd, "pnpm-lock.yaml"))
            ? "pnpm"
            : existsSync(join(this.cwd, "yarn.lock"))
            ? "yarn"
            : "npm";
          const runCmd = pm === "bun" || pm === "pnpm" || pm === "yarn" ? `${pm} run` : "npm run";

          if (pkg.scripts.typecheck) return `${runCmd} typecheck`;
          if (pkg.scripts.check) return `${runCmd} check`;
        }
      } catch (err) {
        console.warn(`[AutoVerifier] Failed to parse package.json for static check:`, err);
      }
    }

    if (existsSync(join(this.cwd, "tsconfig.json"))) {
      return "npx tsc --noEmit";
    }
    if (existsSync(join(this.cwd, "Cargo.toml"))) {
      return "cargo check";
    }
    if (existsSync(join(this.cwd, "go.mod"))) {
      return "go vet ./...";
    }
    if (existsSync(join(this.cwd, "mypy.ini")) || existsSync(join(this.cwd, ".mypy.ini"))) {
      return "mypy .";
    }

    return null;
  }

  /**
   * Resolves the verification command(s) for a given set of modified files.
   * Prioritizes targeted test runner alongside static typecheck.
   */
  public resolveVerificationCommand(modifiedFiles: string[] = []): string | null {
    if (this.customCommand && this.customCommand.trim()) {
      return this.customCommand.trim();
    }

    const targetedTests = this.findTargetedTests(modifiedFiles);
    const targetedTestCmd = this.resolveTargetedTestCommand(targetedTests);
    const staticCmd = this.resolveStaticCommand();

    if (targetedTestCmd && staticCmd) {
      return `${staticCmd} && ${targetedTestCmd}`;
    }
    if (targetedTestCmd) {
      return targetedTestCmd;
    }
    if (staticCmd) {
      return staticCmd;
    }

    // Fallback: check general test command or lint command
    try {
      const analyzer = new ProjectAnalyzer(this.cwd);
      const analysis = analyzer.analyze();
      if (analysis.commands.test) return analysis.commands.test;
      if (analysis.commands.lint) return analysis.commands.lint;
    } catch {}

    const pkgPath = join(this.cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8").replace(/^\uFEFF/, ""));
        if (pkg.scripts?.test) {
          const pm = existsSync(join(this.cwd, "bun.lockb")) || existsSync(join(this.cwd, "bun.lock")) ? "bun" : "npm";
          return pm === "bun" ? "bun test" : "npm test";
        }
        if (pkg.scripts?.lint) {
          return "npm run lint";
        }
      } catch {}
    }

    return null;
  }

  /**
   * Resolves ordered verification stages to run:
   * 1. Static Verification (Typecheck)
   * 2. Targeted Functional Tests (scoped to modified files)
   */
  public resolveVerificationStages(modifiedFiles: string[] = []): string[] {
    if (this.customCommand && this.customCommand.trim()) {
      return [this.customCommand.trim()];
    }

    const stages: string[] = [];
    const staticCmd = this.resolveStaticCommand();
    const targetedTests = this.findTargetedTests(modifiedFiles);
    const targetedTestCmd = this.resolveTargetedTestCommand(targetedTests);

    if (staticCmd) {
      stages.push(staticCmd);
    }
    if (targetedTestCmd) {
      stages.push(targetedTestCmd);
    }

    // Fallback when no static command or targeted tests could be formed
    if (stages.length === 0) {
      const fallback = this.resolveVerificationCommand(modifiedFiles);
      if (fallback) {
        stages.push(fallback);
      }
    }

    return stages;
  }

  /**
   * Executes verification stages asynchronously without blocking the event loop.
   * Supports early abort via AbortSignal and short-circuits on failure.
   */
  public async verify(
    modifiedFiles: string[] = [],
    signal?: AbortSignal
  ): Promise<VerificationResult> {
    const stages = this.resolveVerificationStages(modifiedFiles);
    const startTime = performance.now();

    if (stages.length === 0) {
      return {
        command: "none",
        success: true,
        exitCode: 0,
        output: "No automated verification command configured or detected for this workspace.",
        durationMs: 0,
        reason: "NO_VERIFIER_DETECTED",
      };
    }

    const combinedOutputs: string[] = [];
    let executedCommands: string[] = [];

    for (const cmd of stages) {
      if (signal?.aborted) {
        return {
          command: cmd,
          success: false,
          exitCode: 1,
          output: "Verification was aborted.",
          durationMs: Math.round(performance.now() - startTime),
          reason: "ABORTED",
        };
      }

      executedCommands.push(cmd);
      const stageResult = await this.executeCommandAsync(cmd, signal);

      combinedOutputs.push(`[${cmd}]\n${stageResult.output}`);

      if (!stageResult.success) {
        return {
          command: cmd,
          success: false,
          exitCode: stageResult.exitCode,
          output: this.truncateOutput(combinedOutputs.join("\n\n")),
          durationMs: Math.round(performance.now() - startTime),
        };
      }
    }

    return {
      command: executedCommands.join(" && "),
      success: true,
      exitCode: 0,
      output: this.truncateOutput(combinedOutputs.join("\n\n")),
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Executes a single command asynchronously with timeout and AbortSignal support.
   */
  private executeCommandAsync(
    command: string,
    signal?: AbortSignal
  ): Promise<{ success: boolean; exitCode: number; output: string }> {
    return new Promise((resolve) => {
      let proc: ChildProcess | null = null;
      let stdoutData = "";
      let stderrData = "";
      let isSettled = false;

      const finish = (success: boolean, exitCode: number, output: string) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        resolve({ success, exitCode, output: output.trim() });
      };

      const killProcessTree = () => {
        if (!proc || !proc.pid) return;
        try {
          if (process.platform === "win32") {
            spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
          } else {
            proc.kill("SIGTERM");
            setTimeout(() => {
              try {
                proc?.kill("SIGKILL");
              } catch {}
            }, 500);
          }
        } catch {}
      };

      const onAbort = () => {
        killProcessTree();
        finish(false, 1, "Verification command aborted by user or session signal.");
      };

      if (signal?.aborted) {
        return finish(false, 1, "Verification aborted before launch.");
      }

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const timer = setTimeout(() => {
        killProcessTree();
        const partial = (stdoutData + "\n" + stderrData).trim();
        const timeoutMsg = `[Verification Timeout Error]: Verification command '${command}' exceeded timeout limit of ${this.timeoutMs}ms and was terminated.`;
        finish(false, 1, partial ? `${partial}\n\n${timeoutMsg}` : timeoutMsg);
      }, this.timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      };

      try {
        proc = spawn(command, {
          cwd: this.cwd,
          shell: true,
          env: {
            ...process.env,
            CI: "true",
            FORCE_COLOR: "0",
          },
        });

        proc.stdout?.on("data", (chunk) => {
          stdoutData += chunk.toString();
        });

        proc.stderr?.on("data", (chunk) => {
          stderrData += chunk.toString();
        });

        proc.on("error", (err) => {
          const partial = (stdoutData + "\n" + stderrData).trim();
          const spawnMsg = `[Verification Process Spawn Error]: Failed to spawn command '${command}': ${err.message}`;
          finish(false, 1, partial ? `${partial}\n\n${spawnMsg}` : spawnMsg);
        });

        proc.on("close", (code) => {
          const exitCode = code ?? 0;
          const combined = (stdoutData + "\n" + stderrData).trim();
          if (exitCode === 0) {
            finish(true, 0, combined || "Verification passed cleanly.");
          } else {
            const errorFallback = `[Verification Failure]: Command '${command}' exited with code ${exitCode} and produced no output.`;
            finish(
              false,
              exitCode,
              combined ? `${combined}\n\n[Process exited with non-zero code ${exitCode}]` : errorFallback
            );
          }
        });
      } catch (err: any) {
        finish(false, 1, `[Verification Execution Exception]: ${err.message || String(err)}`);
      }
    });
  }

  /**
   * Caps oversized compiler/test logs to protect the context window.
   */
  private truncateOutput(output: string): string {
    if (output.length > 4000) {
      const lines = output.split("\n");
      if (lines.length > 70) {
        const head = lines.slice(0, 35).join("\n");
        const tail = lines.slice(-30).join("\n");
        return `${head}\n\n... [${lines.length - 65} lines truncated for context efficiency] ...\n\n${tail}`;
      }
    }
    return output;
  }
}
