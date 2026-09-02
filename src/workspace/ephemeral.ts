/**
 * Ephemeral Workspace & Per-Command Scratchpad Manager.
 * Guarantees zero-pollution and ephemeral isolation for temporary files.
 * 
 * Directly mirrors codex-rs/core/src/workspace/ephemeral.rs.
 */

import { mkdirSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export class EphemeralWorkspaceManager {
  private activeScratchpads = new Set<string>();

  /**
   * Creates an isolated per-command/per-turn scratchpad directory in OS temp.
   */
  createScratchpad(turnId?: string): string {
    const uniqueId = `groupy_scratch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const baseDir = join(tmpdir(), "groupy-ephemeral", turnId ? `turn_${turnId}` : "general");
    const scratchPath = join(baseDir, uniqueId);

    mkdirSync(scratchPath, { recursive: true });
    this.activeScratchpads.add(scratchPath);
    return scratchPath;
  }

  /**
   * Cleans up an individual scratchpad directory safely.
   */
  cleanup(scratchPath: string): void {
    if (!scratchPath || !this.activeScratchpads.has(scratchPath)) return;
    try {
      if (existsSync(scratchPath)) {
        rmSync(scratchPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore OS lock errors on cleanup
    } finally {
      this.activeScratchpads.delete(scratchPath);
    }
  }

  /**
   * Cleans up all scratchpads associated with a turn.
   */
  cleanupTurn(turnId: string): void {
    const turnDir = join(tmpdir(), "groupy-ephemeral", `turn_${turnId}`);
    try {
      if (existsSync(turnDir)) {
        rmSync(turnDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore OS lock errors on cleanup
    }
  }

  /**
   * Scans the workspace root for accidental temporary junk files and removes them.
   * Patterns: tmp_*, draft_*, temp_*, scratch_*, preview_*.html, *.tmp
   */
  cleanRootResidue(cwd: string): string[] {
    const cleaned: string[] = [];
    try {
      const files = readdirSync(cwd);
      const tempPatterns = [
        /^tmp_/i,
        /^draft_/i,
        /^scratch_/i,
        /^temp_/i,
        /^preview_.*\.html$/i,
        /\.tmp$/i,
        /\.bak$/i,
        /~$/i,
      ];

      for (const file of files) {
        if (tempPatterns.some((p) => p.test(file))) {
          const fullPath = join(cwd, file);
          const stat = statSync(fullPath);
          if (stat.isFile()) {
            rmSync(fullPath, { force: true });
            cleaned.push(file);
          } else if (stat.isDirectory() && (file.startsWith("tmp_") || file.startsWith("scratch_") || file.startsWith("temp_"))) {
            rmSync(fullPath, { recursive: true, force: true });
            cleaned.push(file);
          }
        }
      }
    } catch {
      // Ignore permissions/read errors
    }
    return cleaned;
  }
}

export const globalEphemeralWorkspace = new EphemeralWorkspaceManager();
