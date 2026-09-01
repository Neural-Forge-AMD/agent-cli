/**
 * SkillsLoader - Discovers and parses directory-based skills with YAML frontmatter.
 * Directly mirrors codex-rs/skills/src/loading.rs, parser.rs, & model.rs.
 * Supports Workspace, Global, and Built-in (Superpowers & Ponytail) skills with toggleable disable/enable controls.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { SkillMetadata, LoadedSkill, SkillScope } from "./types";

export interface SkillsLoaderOptions {
  customRoots?: string[];
  includeGlobal?: boolean;
  includeBuiltIn?: boolean;
  disabledSkills?: string[];
}

export class SkillsLoader {
  private customRoots: string[];
  private includeGlobal: boolean;
  private includeBuiltIn: boolean;
  private disabledSkills: Set<string>;
  private skillsCache = new Map<string, { timestamp: number; skills: SkillMetadata[] }>();

  constructor(optionsOrRoots: SkillsLoaderOptions | string[] = {}) {
    if (Array.isArray(optionsOrRoots)) {
      this.customRoots = optionsOrRoots;
      this.includeGlobal = true;
      this.includeBuiltIn = !process.env.GROUPY_DISABLE_BUILTIN_SKILLS && !process.env.GROUPY_DISABLE_SKILLS;
      this.disabledSkills = new Set(
        (process.env.GROUPY_DISABLED_SKILLS || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      );
    } else {
      this.customRoots = optionsOrRoots.customRoots || [];
      this.includeGlobal = optionsOrRoots.includeGlobal ?? true;
      this.includeBuiltIn =
        optionsOrRoots.includeBuiltIn ??
        (!process.env.GROUPY_DISABLE_BUILTIN_SKILLS && !process.env.GROUPY_DISABLE_SKILLS);
      this.disabledSkills = new Set([
        ...(optionsOrRoots.disabledSkills || []).map((s) => s.trim().toLowerCase()),
        ...(process.env.GROUPY_DISABLED_SKILLS || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ]);
    }
  }

  /**
   * Clears in-memory skills cache
   */
  clearCache(): void {
    this.skillsCache.clear();
  }

  /**
   * Disables a skill by name
   */
  disableSkill(name: string): boolean {
    const key = name.trim().toLowerCase();
    this.disabledSkills.add(key);
    this.clearCache();
    return true;
  }

  /**
   * Re-enables a previously disabled skill
   */
  enableSkill(name: string): boolean {
    const key = name.trim().toLowerCase();
    const res = this.disabledSkills.delete(key);
    this.clearCache();
    return res;
  }

  /**
   * Toggles active state of a skill
   */
  toggleSkill(name: string): boolean {
    const key = name.trim().toLowerCase();
    this.clearCache();
    if (this.disabledSkills.has(key)) {
      this.disabledSkills.delete(key);
      return true; // now enabled
    } else {
      this.disabledSkills.add(key);
      return false; // now disabled
    }
  }

  /**
   * Checks if a skill is currently disabled
   */
  isSkillDisabled(name: string): boolean {
    return this.disabledSkills.has(name.trim().toLowerCase());
  }

  /**
   * Returns list of currently disabled skill names
   */
  getDisabledSkills(): string[] {
    return Array.from(this.disabledSkills);
  }

  /**
   * Enables or disables built-in skills discovery
   */
  setBuiltInEnabled(enabled: boolean): void {
    this.includeBuiltIn = enabled;
    this.clearCache();
  }

  /**
   * Discovers all candidate skill directories
   */
  getDiscoveryRoots(cwd: string): string[] {
    const roots: string[] = [resolve(cwd, ".agents", "skills")];

    // Built-in bundled skills (Groupy package root skills/)
    if (this.includeBuiltIn) {
      const candidates = [
        resolve(__dirname, "..", "..", "skills"),
        resolve(__dirname, "..", "skills"),
        resolve(cwd, "skills"),
      ];
      for (const cand of candidates) {
        if (existsSync(cand) && !roots.includes(cand)) {
          roots.push(cand);
        }
      }
    }

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
  discoverSkills(cwd: string, options?: { includeDisabled?: boolean }): SkillMetadata[] {
    return this.listSkills(cwd, options);
  }

  listSkills(cwd: string, options?: { includeDisabled?: boolean }): SkillMetadata[] {
    const cacheKey = `${cwd}:${options?.includeDisabled ?? false}`;
    const cached = this.skillsCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < 30_000) {
      return cached.skills;
    }

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
                meta.enabled = !this.isSkillDisabled(meta.name);
                if (options?.includeDisabled || meta.enabled) {
                  discovered.set(meta.name, meta);
                }
              }
            }
          }
        }
      } catch {}
    }

    const result = Array.from(discovered.values());
    this.skillsCache.set(cacheKey, { timestamp: now, skills: result });
    return result;
  }

  /**
   * Loads full markdown instructions for a specific skill (supports exact and normalized/fuzzy naming)
   */
  loadSkill(cwd: string, skillName: string): LoadedSkill | null {
    if (this.isSkillDisabled(skillName)) {
      return null;
    }

    const all = this.listSkills(cwd, { includeDisabled: false });
    const target = skillName.trim().toLowerCase();
    const normalize = (str: string) => str.toLowerCase().replace(/[-_\s]/g, "");
    const targetNorm = normalize(skillName);

    const meta =
      all.find((s) => s.name.toLowerCase() === target) ||
      all.find((s) => normalize(s.name) === targetNorm);
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
    dirName: string,
    root: string,
    cwd: string
  ): SkillMetadata | null {
    try {
      const raw = readFileSync(filePath, "utf8");
      const { attributes } = this.extractFrontmatterAndBody(raw);

      let scope: SkillScope = "global";
      const normPath = filePath.toLowerCase().replace(/\\/g, "/");
      const normCwd = cwd.toLowerCase().replace(/\\/g, "/");
      const normRoot = root.toLowerCase().replace(/\\/g, "/");

      if (
        normRoot.includes(".agents") ||
        normRoot === `${normCwd}/skills` ||
        normPath.startsWith(normCwd) ||
        this.customRoots.some((r) => normPath.startsWith(resolve(r).toLowerCase().replace(/\\/g, "/")))
      ) {
        scope = "workspace";
      } else if (normRoot.includes("groupy") && (normRoot.endsWith("skills") || normRoot.includes("plugins"))) {
        scope = "built-in";
      }

      const name = attributes["name"] || dirName;
      const description = attributes["description"] || "Autonomous agent skill";
      const shortDescription = attributes["short-description"] || attributes["summary"];

      return {
        name,
        description,
        shortDescription,
        path: filePath,
        rootDir: root,
        dirPath: resolve(filePath, ".."),
        scope,
        enabled: true,
        tags: attributes["tags"]
          ? attributes["tags"].split(",").map((t) => t.trim())
          : undefined,
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

    if (raw.startsWith("---")) {
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (match) {
        const yamlContent = match[1] ?? "";
        body = match[2] ?? "";

        const lines = yamlContent.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;

          const colonIdx = trimmed.indexOf(":");
          if (colonIdx === -1) continue;

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
    const skills = this.listSkills(cwd, { includeDisabled: false });
    if (skills.length === 0) return "";

    // Prioritize ALL workspace skills first, then built-in skills, then global skills (to keep prompt lean & fast)
    const workspaceSkills = skills.filter((s) => s.scope === "workspace");
    const builtInSkills = skills.filter((s) => s.scope === "built-in");
    const otherSkills = skills.filter((s) => s.scope !== "workspace" && s.scope !== "built-in");
    const selectedSkills = [...workspaceSkills, ...builtInSkills, ...otherSkills].slice(0, 150);

    const lines = selectedSkills.map((s) => {
      const desc = s.shortDescription || s.description;
      return `- **${s.name}**: ${desc}`;
    });
    const suffix =
      skills.length > selectedSkills.length
        ? `\n... and ${skills.length - selectedSkills.length} additional domain skills available via \`load_skill\`.`
        : "";

    return `\n## Available Domain Skills\n<available_skills>\n${lines.join("\n")}${suffix}\n</available_skills>\nWhen tackling complex specialized tasks that match any of these skills, autonomously use the \`load_skill\` tool to retrieve full instructions before implementing.`;
  }
}
