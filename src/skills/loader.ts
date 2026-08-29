/**
 * SkillsLoader - Discovers and parses directory-based skills with YAML frontmatter.
 * Directly mirrors codex-rs/skills/src/loading.rs, parser.rs, & model.rs.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { SkillMetadata, LoadedSkill } from "./types";

export interface SkillsLoaderOptions {
  customRoots?: string[];
  includeGlobal?: boolean;
}

export class SkillsLoader {
  private customRoots: string[];
  private includeGlobal: boolean;

  constructor(optionsOrRoots: SkillsLoaderOptions | string[] = {}) {
    if (Array.isArray(optionsOrRoots)) {
      this.customRoots = optionsOrRoots;
      this.includeGlobal = true;
    } else {
      this.customRoots = optionsOrRoots.customRoots || [];
      this.includeGlobal = optionsOrRoots.includeGlobal ?? true;
    }
  }

  /**
   * Discovers all candidate skill directories
   */
  getDiscoveryRoots(cwd: string): string[] {
    const roots: string[] = [resolve(cwd, ".agents", "skills")];

    if (this.includeGlobal) {
      roots.push(
        resolve(homedir(), ".groupy", "skills"),
        resolve(homedir(), ".gemini", "config", "skills")
      );
    }

    roots.push(...this.customRoots.map((r) => resolve(r)));
    return roots.filter((r) => existsSync(r));
  }

  /**
   * Scans roots and returns metadata for all valid skills
   */
  discoverSkills(cwd: string): SkillMetadata[] {
    return this.listSkills(cwd);
  }

  listSkills(cwd: string): SkillMetadata[] {
    const roots = this.getDiscoveryRoots(cwd);
    const discovered = new Map<string, SkillMetadata>();

    for (const root of roots) {
      try {
        const entries = readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillDir = join(root, entry.name);
            const skillFilePath = join(skillDir, "SKILL.md");

            if (existsSync(skillFilePath)) {
              const meta = this.parseSkillFrontmatter(skillFilePath, entry.name, root, cwd);
              if (meta && !discovered.has(meta.name)) {
                discovered.set(meta.name, meta);
              }
            }
          }
        }
      } catch {}
    }

    return Array.from(discovered.values());
  }

  /**
   * Loads full markdown instructions for a specific skill
   */
  loadSkill(cwd: string, skillName: string): LoadedSkill | null {
    const all = this.listSkills(cwd);
    const meta = all.find((s) => s.name.toLowerCase() === skillName.toLowerCase());
    if (!meta) return null;

    try {
      const raw = readFileSync(meta.path, "utf8");
      const { body } = this.extractFrontmatterAndBody(raw);
      return {
        ...meta,
        instructions: body.trim(),
      };
    } catch {
      return null;
    }
  }

  private parseSkillFrontmatter(
    filePath: string,
    fallbackName: string,
    rootDir: string,
    cwd: string
  ): SkillMetadata | null {
    try {
      const raw = readFileSync(filePath, "utf8");
      const { attributes } = this.extractFrontmatterAndBody(raw);
      const isWorkspace = filePath.startsWith(resolve(cwd, ".agents"));

      return {
        name: attributes.name || fallbackName,
        description: attributes.description || "Specialized skill workflow.",
        shortDescription: attributes.short_description || attributes.shortDescription,
        path: filePath,
        rootDir,
        scope: isWorkspace ? "workspace" : "global",
      };
    } catch {
      return null;
    }
  }

  private extractFrontmatterAndBody(raw: string): {
    attributes: Record<string, string>;
    body: string;
  } {
    const attributes: Record<string, string> = {};
    let body = raw;

    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (match) {
      const frontmatterText = match[1] || "";
      body = match[2] || "";

      for (const line of frontmatterText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const colonIdx = trimmed.indexOf(":");
        if (colonIdx > 0) {
          const key = trimmed.slice(0, colonIdx).trim();
          let val = trimmed.slice(colonIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          attributes[key] = val;
        }
      }
    }

    return { attributes, body };
  }

  formatSkillsPrompt(cwd: string): string {
    const skills = this.listSkills(cwd);
    if (skills.length === 0) return "";

    // Limit system prompt to at most top 30 most relevant skills to conserve context tokens
    const topSkills = skills.slice(0, 30);
    const lines = topSkills.map((s) => `- **${s.name}**: ${s.description}`);
    const suffix = skills.length > 30 ? `\n... and ${skills.length - 30} more specialized skills.` : "";
    return `\n## Available Domain Skills\n<available_skills>\n${lines.join("\n")}${suffix}\n</available_skills>\nWhen tackling complex specialized tasks that match any of these skills, use the \`load_skill\` tool to retrieve full instructions.`;
  }
}
