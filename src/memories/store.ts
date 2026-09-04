/**
 * AutoMemoryStore - Persistent Auto-Memory Subsystem.
 * Aligned with Anthropic Claude Code Auto-Memory specifications.
 * 
 * Manages project-level Auto-Memory (~/.pikaa/projects/<project-id>/memory/):
 * - MEMORY.md: Concise 1-line index loaded at session startup (capped at 200 lines / 25KB).
 * - Topic Files (<type>_<name>.md): Detailed Markdown files with YAML frontmatter, read on-demand.
 * 
 * Supports standard categories: user, feedback, project, reference.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { MemoryCategory, MemoryEntry, TopicMemoryFile } from "./types";
import { getGlobalMemoriesPath, getProjectsDir } from "../config/paths";

export class MemoryStore {
  private globalPath: string;
  private customWorkspacePath?: string;

  constructor(options: { globalPath?: string; workspacePath?: string } = {}) {
    this.globalPath = options.globalPath || getGlobalMemoriesPath();
    this.customWorkspacePath = options.workspacePath;
  }

  /**
   * Finds the nearest ancestor directory containing a project root marker (.git).
   */
  findProjectRoot(cwd: string): string {
    let current = resolve(cwd);
    while (true) {
      if (existsSync(join(current, ".git"))) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) {
        return resolve(cwd);
      }
      current = parent;
    }
  }

  /**
   * Computes a deterministic, human-readable directory slug for a project repository.
   * Format: <folder-name>-<hash-6>
   */
  getProjectSlug(cwd: string): string {
    const root = this.findProjectRoot(cwd);
    const folderName = basename(root).toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "project";
    const hash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 6);
    return `${folderName}-${hash}`;
  }

  /**
   * Returns the directory path for project auto-memory: ~/.pikaa/projects/<slug>/memory/
   */
  getProjectMemoryDir(cwd: string): string {
    if (this.customWorkspacePath) {
      const dir = resolve(this.customWorkspacePath);
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true });
        } catch (err) {
          console.warn(`[MemoryStore] Failed to create custom memory directory '${dir}':`, err);
        }
      }
      return dir;
    }

    const slug = this.getProjectSlug(cwd);
    const dir = join(getProjectsDir(), slug, "memory");
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.warn(`[MemoryStore] Failed to create project memory directory '${dir}':`, err);
      }
    }
    return dir;
  }

  /**
   * Returns path to the MEMORY.md index file for the current project.
   */
  getMemoryIndexPath(cwd: string): string {
    return join(this.getProjectMemoryDir(cwd), "MEMORY.md");
  }

  private normalizeCategory(raw: string): "user" | "feedback" | "project" | "reference" {
    const cat = raw.toLowerCase().trim();
    if (cat === "user" || cat === "preference") return "user";
    if (cat === "feedback" || cat === "guideline") return "feedback";
    if (cat === "project" || cat === "architecture") return "project";
    if (cat === "reference" || cat === "note") return "reference";
    return "project";
  }

  /**
   * Saves or updates a persistent topic memory file and synchronizes the MEMORY.md index.
   */
  saveTopicMemory(params: {
    category: MemoryCategory;
    name: string;
    description?: string;
    content: string;
    cwd: string;
  }): MemoryEntry {
    const type = this.normalizeCategory(params.category);
    const sanitizedName = params.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, "_")
      .replace(/^_+|_+$/g, "") || `note_${Date.now()}`;

    const memoryDir = this.getProjectMemoryDir(params.cwd);
    const fileName = `${type}_${sanitizedName}.md`;
    const filePath = join(memoryDir, fileName);

    const nowIso = new Date().toISOString();
    const cleanContent = params.content.trim();
    const desc = (params.description || cleanContent.split("\n")[0] || sanitizedName).replace(/[\r\n]+/g, " ");

    const frontmatter = [
      "---",
      `type: ${type}`,
      `name: ${sanitizedName}`,
      `description: ${desc}`,
      `modified: ${nowIso}`,
      "---",
      "",
      `# ${sanitizedName.replace(/_/g, " ").toUpperCase()}`,
      "",
      cleanContent,
      "",
    ].join("\n");

    writeFileSync(filePath, frontmatter, "utf8");

    // Update MEMORY.md index
    this.syncMemoryIndex(params.cwd);

    return {
      id: `mem_${sanitizedName}`,
      category: type,
      name: sanitizedName,
      description: desc,
      content: cleanContent,
      scope: "project",
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      filePath,
    };
  }

  /**
   * Reads a specific topic memory file.
   */
  readTopicMemory(topicNameOrFile: string, cwd: string): TopicMemoryFile | null {
    const memoryDir = this.getProjectMemoryDir(cwd);
    let targetPath = join(memoryDir, topicNameOrFile);

    if (!existsSync(targetPath)) {
      if (!topicNameOrFile.endsWith(".md")) {
        // Try looking up with .md
        targetPath = join(memoryDir, `${topicNameOrFile}.md`);
      }
    }

    if (!existsSync(targetPath)) {
      // Search matching filename pattern
      const files = readdirSync(memoryDir);
      const match = files.find((f) => f.includes(topicNameOrFile));
      if (match) {
        targetPath = join(memoryDir, match);
      } else {
        return null;
      }
    }

    try {
      const raw = readFileSync(targetPath, "utf8");
      return this.parseTopicFile(raw, targetPath);
    } catch {
      return null;
    }
  }

  /**
   * Parses YAML frontmatter and body from a topic file.
   */
  private parseTopicFile(raw: string, filePath: string): TopicMemoryFile {
    const lines = raw.split("\n");
    let inFm = false;
    let type: "user" | "feedback" | "project" | "reference" = "project";
    let name = basename(filePath, ".md");
    let description: string | undefined;
    let modified = new Date().toISOString();
    const bodyLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (i === 0 && line.trim() === "---") {
        inFm = true;
        continue;
      }
      if (inFm) {
        if (line.trim() === "---") {
          inFm = false;
          continue;
        }
        const colonIdx = line.indexOf(":");
        if (colonIdx !== -1) {
          const key = line.slice(0, colonIdx).trim();
          const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
          if (key === "type") type = this.normalizeCategory(val);
          else if (key === "name") name = val;
          else if (key === "description") description = val;
          else if (key === "modified") modified = val;
        }
      } else {
        bodyLines.push(line);
      }
    }

    return {
      type,
      name,
      description,
      modified,
      content: bodyLines.join("\n").trim(),
      filePath,
    };
  }

  /**
   * Synchronizes all topic files into MEMORY.md index with 200-line / 25KB budget limit.
   */
  syncMemoryIndex(cwd: string): void {
    const memoryDir = this.getProjectMemoryDir(cwd);
    const indexPath = join(memoryDir, "MEMORY.md");

    const files = existsSync(memoryDir)
      ? readdirSync(memoryDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
      : [];

    const items: Array<{ type: string; name: string; desc: string; file: string }> = [];

    for (const f of files) {
      try {
        const full = join(memoryDir, f);
        const parsed = this.parseTopicFile(readFileSync(full, "utf8"), full);
        items.push({
          type: parsed.type,
          name: parsed.name,
          desc: parsed.description || parsed.content.split("\n")[0] || parsed.name,
          file: f,
        });
      } catch (err) {
        console.warn(`[MemoryStore] Failed to parse topic memory file '${f}':`, err);
      }
    }

    const indexLines = [
      "# Project Auto-Memory Index",
      "",
      "This index is loaded at session startup. Detailed topics can be retrieved via read_memory tool.",
      "",
    ];

    for (const item of items) {
      indexLines.push(`- [${item.type}] **${item.name}**: ${item.desc} (topic: ${item.file})`);
    }

    // Limit index to 200 lines
    const boundedLines = indexLines.slice(0, 200);
    writeFileSync(indexPath, boundedLines.join("\n") + "\n", "utf8");
  }

  /**
   * Loads MEMORY.md index content (capped at 200 lines or 25KB).
   */
  loadMemoryIndex(cwd: string): string {
    const indexPath = this.getMemoryIndexPath(cwd);
    if (!existsSync(indexPath)) return "";

    try {
      const raw = readFileSync(indexPath, "utf8");
      // Capped at 25KB
      const byteLimit = 25 * 1024;
      const sliced = raw.length > byteLimit ? raw.slice(0, byteLimit) : raw;
      const lines = sliced.split("\n").slice(0, 200);
      return lines.join("\n").trim();
    } catch {
      return "";
    }
  }

  /**
   * Lists all project memory topics.
   */
  listProjectMemories(cwd: string): TopicMemoryFile[] {
    const memoryDir = this.getProjectMemoryDir(cwd);
    if (!existsSync(memoryDir)) return [];

    const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
    const list: TopicMemoryFile[] = [];

    for (const f of files) {
      try {
        const full = join(memoryDir, f);
        list.push(this.parseTopicFile(readFileSync(full, "utf8"), full));
      } catch (err) {
        console.warn(`[MemoryStore] Failed to read topic memory file '${f}':`, err);
      }
    }

    return list;
  }

  /**
   * Backward-compatible addMemory for simple one-liners and legacy tools.
   */
  addMemory(params: {
    category: MemoryCategory;
    content: string;
    scope?: "global" | "workspace";
    cwd?: string;
    name?: string;
  }): MemoryEntry {
    const cwd = params.cwd || process.cwd();
    const type = this.normalizeCategory(params.category);
    const name = params.name || `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    // Save as Auto-Memory Topic File
    const entry = this.saveTopicMemory({
      category: type,
      name,
      content: params.content,
      cwd,
    });
    if (params.scope) {
      entry.scope = params.scope;
    }
    return entry;
  }

  /**
   * Returns all memories (Auto-Memory topics + legacy workspace/global files).
   */
  getAllMemories(cwd: string): MemoryEntry[] {
    const projectTopics = this.listProjectMemories(cwd).map((t) => ({
      id: `mem_${t.name}`,
      category: t.type as MemoryCategory,
      name: t.name,
      description: t.description,
      content: t.content,
      scope: (t.type === "user" ? "global" : "workspace") as "global" | "workspace" | "project",
      createdAt: new Date(t.modified).getTime() || Date.now(),
      filePath: t.filePath,
    }));

    return projectTopics;
  }

  /**
   * Formats persistent Auto-Memory into system prompt section.
   */
  formatMemoriesPrompt(cwd: string): string {
    const indexContent = this.loadMemoryIndex(cwd);
    if (!indexContent) return "";

    return [
      "",
      "## Project Auto-Memory (Persistent Learnings)",
      "<auto_memory>",
      indexContent,
      "</auto_memory>",
      "Apply these persistent project learnings, user preferences, and feedback across all tasks.",
      "If more context is needed for a specific topic, retrieve it using the `read_memory` tool.",
    ].join("\n");
  }
}
