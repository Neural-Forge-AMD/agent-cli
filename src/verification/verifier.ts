/**
 * Automated Self-Verification Engine.
 * Automatically runs typechecks, linter checks, or targeted test runners
 * whenever an agent mutates code files during a turn.
 */

import { spawnSync } from "node:child_process";
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
   * Resolves the highest-signal, fastest verification command for the current project.
   * Priority:
   * 1. Explicit custom command override
   * 2. Project analyzer typecheck command (e.g. 'bun run typecheck', 'tsc --noEmit', 'cargo check')
   * 3. Project analyzer test command (if fast/defined)
   * 4. Ambient tsconfig.json -> 'npx tsc --noEmit'
   */
  public resolveVerificationCommand(): string | null {
    if (this.customCommand && this.customCommand.trim()) {
      return this.customCommand.trim();
    }

    // 1. Check ProjectAnalyzer
    try {
      const analyzer = new ProjectAnalyzer(this.cwd);
      const analysis = analyzer.analyze();

      if (analysis.commands.typecheck) {
        return analysis.commands.typecheck;
      }
      if (analysis.commands.lint) {
        return analysis.commands.lint;
      }
      if (analysis.commands.test) {
        return analysis.commands.test;
      }
    } catch {}

    // 2. Fallback: Check package.json scripts directly
    const pkgPath = join(this.cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.scripts) {
          const pm = existsSync(join(this.cwd, "bun.lockb")) || existsSync(join(this.cwd, "bun.lock"))
            ? "bun"
            : existsSync(join(this.cwd, "pnpm-lock.yaml"))
            ? "pnpm"
            : existsSync(join(this.cwd, "yarn.lock"))
            ? "yarn"
            : "npm";
          const runCmd = pm === "bun" || pm === "pnpm" || pm === "yarn" ? `${pm} run` : "npm run";
          const testCmd = pm === "bun" ? "bun test" : `${pm} test`;

          if (pkg.scripts.typecheck) return `${runCmd} typecheck`;
          if (pkg.scripts.check) return `${runCmd} check`;
          if (pkg.scripts.test) return testCmd;
        }
      } catch {}
    }

    // 3. Fallback: TypeScript tsconfig.json without scripts
    if (existsSync(join(this.cwd, "tsconfig.json"))) {
      // Check if bun or tsc is available
      return "npx tsc --noEmit";
    }

    // 4. Rust Cargo project
    if (existsSync(join(this.cwd, "Cargo.toml"))) {
      return "cargo check";
    }

    // 5. Go project
    if (existsSync(join(this.cwd, "go.mod"))) {
      return "go vet ./...";
    }

    // 6. Python project
    if (existsSync(join(this.cwd, "pyproject.toml")) || existsSync(join(this.cwd, "setup.py"))) {
      if (existsSync(join(this.cwd, "mypy.ini")) || existsSync(join(this.cwd, ".mypy.ini"))) {
        return "mypy .";
      }
    }

    return null;
  }

  /**
   * Executes the resolved verification command and returns structured results.
   */
  public verify(modifiedFiles: string[] = []): VerificationResult {
    const command = this.resolveVerificationCommand();
    const startTime = performance.now();

    if (!command) {
      return {
        command: "none",
        success: true,
        exitCode: 0,
        output: "No automated verification command configured or detected for this workspace.",
        durationMs: 0,
        reason: "NO_VERIFIER_DETECTED",
      };
    }

    try {
      const isWindows = process.platform === "win32";
      const proc = spawnSync(command, {
        cwd: this.cwd,
        shell: true,
        encoding: "utf8",
        timeout: this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          CI: "true",
          FORCE_COLOR: "0",
        },
      });

      const durationMs = Math.round(performance.now() - startTime);
      const stdout = proc.stdout ? String(proc.stdout) : "";
      const stderr = proc.stderr ? String(proc.stderr) : "";
      let combined = (stdout + "\n" + stderr).trim();

      if (proc.error) {
        const isTimeout = (proc.error as any).code === "ETIMEDOUT";
        const errMsg = isTimeout
          ? `Verification command timed out after ${this.timeoutMs}ms: ${proc.error.message}`
          : `Verification execution error: ${proc.error.message}`;
        combined = combined ? `${combined}\n${errMsg}` : errMsg;
      }

      // Truncate gigantic compiler outputs to prevent token bloat
      if (combined.length > 3000) {
        const lines = combined.split("\n");
        if (lines.length > 60) {
          const head = lines.slice(0, 30).join("\n");
          const tail = lines.slice(-25).join("\n");
          combined = `${head}\n\n... [${lines.length - 55} lines truncated for context efficiency] ...\n\n${tail}`;
        }
      }

      const exitCode = proc.status ?? (proc.error ? 1 : 0);
      const success = exitCode === 0;

      return {
        command,
        success,
        exitCode,
        output: combined || (success ? "Verification succeeded cleanly." : "Command failed with empty output."),
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      return {
        command,
        success: false,
        exitCode: 1,
        output: `Verification execution error: ${err.message || String(err)}`,
        durationMs,
      };
    }
  }
}
