/**
 * MemoryStore - Reads, writes, and synchronizes persistent memories.
 * Directly mirrors codex-rs/memories read and write pipelines.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { MemoryCategory, MemoryEntry } from "./types";

export class MemoryStore {
  private globalPath: string;
  private customWorkspacePath?: string;

  constructor(options: { globalPath?: string; workspacePath?: string } = {}) {
    this.globalPath = options.globalPath || resolve(homedir(), ".groupy", "memories.md");
    this.customWorkspacePath = options.workspacePath;
  }

  private getWorkspacePath(cwd: string): string {
    return this.customWorkspacePath || resolve(cwd, ".agents", "memories.md");
  }

  /**
   * Adds a new memory item to either global or workspace memory bank
   */
  addMemory(params: {
    category: MemoryCategory;
    content: string;
    scope?: "global" | "workspace";
    cwd?: string;
  }): MemoryEntry {
    const scope = params.scope || "global";
    const targetFile =
      scope === "global" ? this.globalPath : this.getWorkspacePath(params.cwd || process.cwd());

    const dir = dirname(targetFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const existingEntries = this.readMemoryFile(targetFile, scope);
    const normalized = params.content.trim();

    // Check for duplicate
    const duplicate = existingEntries.find(
      (e) => e.category === params.category && e.content.toLowerCase() === normalized.toLowerCase()
    );

    if (duplicate) {
      return duplicate;
    }

    const newEntry: MemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      category: params.category,
      content: normalized,
      scope,
      createdAt: Date.now(),
    };

    existingEntries.push(newEntry);
    this.writeMemoryFile(targetFile, existingEntries);

    return newEntry;
  }

  /**
   * Reads all memories from both global and workspace banks
   */
  getAllMemories(cwd: string): MemoryEntry[] {
    const globalEntries = this.readMemoryFile(this.globalPath, "global");
    const workspacePath = this.getWorkspacePath(cwd);
    const workspaceEntries = existsSync(workspacePath)
      ? this.readMemoryFile(workspacePath, "workspace")
      : [];

    return [...globalEntries, ...workspaceEntries];
  }

  private readMemoryFile(filePath: string, scope: "global" | "workspace"): MemoryEntry[] {
    if (!existsSync(filePath)) return [];

    try {
      const content = readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      const entries: MemoryEntry[] = [];
      let currentCategory: MemoryCategory = "preference";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("## Preferences") || trimmed.startsWith("## User Preferences")) {
          currentCategory = "preference";
        } else if (trimmed.startsWith("## Guidelines") || trimmed.startsWith("## Coding Guidelines")) {
          currentCategory = "guideline";
        } else if (trimmed.startsWith("## Architecture") || trimmed.startsWith("## Project Architecture")) {
          currentCategory = "architecture";
        } else if (trimmed.startsWith("## Notes") || trimmed.startsWith("## General Notes")) {
          currentCategory = "note";
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          const itemText = trimmed.slice(2).trim();
          if (itemText) {
            entries.push({
              id: `mem_${entries.length + 1}`,
              category: currentCategory,
              content: itemText,
              scope,
              createdAt: Date.now(),
            });
          }
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  private writeMemoryFile(filePath: string, entries: MemoryEntry[]): void {
    const categories: Record<MemoryCategory, string[]> = {
      preference: [],
      guideline: [],
      architecture: [],
      note: [],
    };

    for (const entry of entries) {
      categories[entry.category].push(entry.content);
    }

    let markdown = `# Groupy Persistent Memories\n\n`;

    if (categories.preference.length > 0) {
      markdown += `## User Preferences\n${categories.preference.map((p) => `- ${p}`).join("\n")}\n\n`;
    }
    if (categories.guideline.length > 0) {
      markdown += `## Coding Guidelines\n${categories.guideline.map((g) => `- ${g}`).join("\n")}\n\n`;
    }
    if (categories.architecture.length > 0) {
      markdown += `## Project Architecture\n${categories.architecture.map((a) => `- ${a}`).join("\n")}\n\n`;
    }
    if (categories.note.length > 0) {
      markdown += `## General Notes\n${categories.note.map((n) => `- ${n}`).join("\n")}\n\n`;
    }

    writeFileSync(filePath, markdown.trim() + "\n", "utf8");
  }

  /**
   * Formats persistent memories into system prompt section
   */
  formatMemoriesPrompt(cwd: string): string {
    const memories = this.getAllMemories(cwd);
    if (memories.length === 0) return "";

    const lines = memories.map((m) => `- [${m.category}] (${m.scope}): ${m.content}`);
    return `\n## Persistent User Preferences & Memory Bank\n<user_memories>\n${lines.join("\n")}\n</user_memories>\nStrictly respect these learned user preferences and project architectural conventions.`;
  }
}
