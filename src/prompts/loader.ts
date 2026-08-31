/**
 * PromptTemplateLoader - Loads Markdown prompt templates with 3-tier precedence and variable interpolation.
 * Precedence: Workspace override (.agents/templates/) -> Global override (~/.groupy/templates/) -> Built-in defaults (templates/).
 * 
 * Directly mirrors codex-rs/collaboration-mode-templates and codex-rs/prompts.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { TemplateVariables } from "./types";

export class PromptTemplateLoader {
  private builtInTemplatesDir: string;

  constructor(builtInDir?: string) {
    // Locate the built-in templates directory
    this.builtInTemplatesDir =
      builtInDir || resolve(join(import.meta.dir, "..", "..", "templates"));
  }

  /**
   * Loads a template file by relative path and replaces {{variable}} placeholders.
   */
  loadTemplate(
    relativePath: string,
    variables: TemplateVariables = {},
    cwd?: string
  ): string {
    const rawContent = this.resolveTemplateContent(relativePath, cwd);
    return this.renderVariables(rawContent, variables);
  }

  /**
   * Resolves the raw content of a template file respecting precedence.
   */
  resolveTemplateContent(relativePath: string, cwd?: string): string {
    const normalizedRel = relativePath.replace(/^\/+/, "");

    // 1. Workspace override: <cwd>/.agents/templates/<relativePath>
    if (cwd) {
      const workspacePath = join(cwd, ".agents", "templates", normalizedRel);
      if (existsSync(workspacePath)) {
        try {
          return readFileSync(workspacePath, "utf-8");
        } catch {}
      }
    }

    // 2. Global user override: ~/.groupy/templates/<relativePath>
    const globalPath = join(homedir(), ".groupy", "templates", normalizedRel);
    if (existsSync(globalPath)) {
      try {
        return readFileSync(globalPath, "utf-8");
      } catch {}
    }

    // 3. Built-in templates: groupy/templates/<relativePath>
    const builtInPath = join(this.builtInTemplatesDir, normalizedRel);
    if (existsSync(builtInPath)) {
      try {
        return readFileSync(builtInPath, "utf-8");
      } catch {}
    }

    return "";
  }

  /**
   * Renders {{variable}} placeholders in template text.
   */
  renderVariables(template: string, variables: TemplateVariables): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => {
      const val = variables[key];
      return val !== undefined ? String(val) : "";
    });
  }
}

// Global singleton instance
export const globalPromptLoader = new PromptTemplateLoader();
