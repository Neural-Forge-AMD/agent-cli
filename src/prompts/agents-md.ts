/**
 * Hierarchical AGENTS.md Loader & Discovery Engine.
 * Scans directories from the project root marker (.git) down to the current working directory,
 * concatenating all instruction documents with `--- project-doc ---` delimiters.
 * 
 * Directly mirrors codex-rs/core/src/agents_md.rs.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import type { LoadedAgentsMd } from "./types";

export const DEFAULT_AGENTS_MD_FILENAMES = [
  "AGENTS.override.md",
  "AGENTS.md",
  ".agents.md",
  "CLAUDE.md",
];

const AGENTS_MD_SEPARATOR = "\n\n--- project-doc ---\n\n";

export class AgentsMdLoader {
  /**
   * Finds the nearest ancestor directory containing a project root marker (.git).
   */
  findProjectRoot(startDir: string): string {
    let current = resolve(startDir);

    while (true) {
      if (existsSync(join(current, ".git"))) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) {
        // Reached filesystem root
        return resolve(startDir);
      }
      current = parent;
    }
  }

  /**
   * Collects all directory paths from project root down to target directory (inclusive).
   */
  collectDirectoryHierarchy(targetDir: string, rootDir: string): string[] {
    const hierarchy: string[] = [];
    let current = resolve(targetDir);
    const normalizedRoot = resolve(rootDir);

    while (true) {
      hierarchy.unshift(current);
      if (current === normalizedRoot) {
        break;
      }
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    return hierarchy;
  }

  /**
   * Discovers and loads all hierarchical AGENTS.md files from root to cwd.
   */
  loadProjectInstructions(
    cwd: string,
    fallbackFilenames: string[] = DEFAULT_AGENTS_MD_FILENAMES
  ): LoadedAgentsMd | null {
    const projectRoot = this.findProjectRoot(cwd);
    const dirHierarchy = this.collectDirectoryHierarchy(cwd, projectRoot);

    const docSections: string[] = [];
    const sourcePaths: string[] = [];

    for (const dir of dirHierarchy) {
      for (const filename of fallbackFilenames) {
        const filePath = join(dir, filename);
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, "utf-8").trim();
            if (content) {
              docSections.push(content);
              sourcePaths.push(filePath);
              // Pick highest precedence filename in this folder (e.g. AGENTS.override.md over AGENTS.md)
              break;
            }
          } catch {}
        }
      }
    }

    if (docSections.length === 0) {
      return null;
    }

    return {
      content: docSections.join(AGENTS_MD_SEPARATOR),
      sourcePaths,
    };
  }
}

export const globalAgentsMdLoader = new AgentsMdLoader();
