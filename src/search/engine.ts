/**
 * FileSearchEngine - Ultra-fast directory walker, regex pattern search, and file finder.
 * Directly mirrors codex-rs/file-search with .gitignore awareness and binary filtration.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { resolve, relative, join, extname } from "node:path";
import type { GrepOptions, GrepResult, GrepMatch, FindFilesOptions } from "./types";

const DEFAULT_IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  "vendor",
  ".gemini",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".cache",
  ".turbo",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".sqlite",
  ".db",
  ".lockb",
  ".bin",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

export class FileSearchEngine {
  /**
   * Search for text or regular expressions across files in a directory
   */
  grep(cwd: string, options: GrepOptions): GrepResult {
    const searchRoot = resolve(cwd, options.path || ".");
    if (!existsSync(searchRoot)) {
      return { matches: [], totalMatches: 0, truncated: false };
    }

    const maxResults = options.maxResults || 50;
    const matches: GrepMatch[] = [];
    let totalMatches = 0;
    let truncated = false;

    let regex: RegExp;
    try {
      const flags = options.caseSensitive ? "" : "i";
      if (options.isRegex) {
        regex = new RegExp(options.query, flags);
      } else {
        const escaped = options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(escaped, flags);
      }
    } catch {
      return { matches: [], totalMatches: 0, truncated: false };
    }

    const gitignoreRules = this.loadGitignoreRules(searchRoot);
    const files = this.collectFiles(searchRoot, searchRoot, gitignoreRules, options.includePattern);

    for (const filePath of files) {
      if (truncated) break;

      try {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (regex.test(line)) {
            totalMatches++;
            if (matches.length < maxResults) {
              matches.push({
                file: relative(cwd, filePath).replace(/\\/g, "/"),
                lineNumber: i + 1,
                lineContent: line.trimEnd().slice(0, 300),
              });
            } else {
              truncated = true;
              break;
            }
          }
        }
      } catch {
        // Skip unreadable / binary files
      }
    }

    return { matches, totalMatches, truncated };
  }

  /**
   * Find files matching a glob or substring pattern
   */
  findFiles(cwd: string, options: FindFilesOptions): string[] {
    const searchRoot = resolve(cwd, options.path || ".");
    if (!existsSync(searchRoot)) return [];

    const maxResults = options.maxResults || 100;
    const gitignoreRules = this.loadGitignoreRules(searchRoot);
    const files = this.collectFiles(searchRoot, searchRoot, gitignoreRules);

    const rawPattern = options.pattern.trim();
    const isWildcard = rawPattern.includes("*") || rawPattern.includes("?");

    let matcher: (relPath: string) => boolean;
    if (isWildcard) {
      if (!rawPattern.includes("/")) {
        const regexPattern = rawPattern
          .replace(/\./g, "\\.")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".");
        const regex = new RegExp(`(^|.*/)${regexPattern}$`, "i");
        matcher = (p) => regex.test(p);
      } else {
        const regexPattern = rawPattern
          .replace(/\./g, "\\.")
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, ".");
        const regex = new RegExp(`^${regexPattern}$`, "i");
        matcher = (p) => regex.test(p);
      }
    } else {
      matcher = (p) => p.toLowerCase().includes(rawPattern.toLowerCase());
    }

    const matchedFiles: string[] = [];
    for (const file of files) {
      const relPath = relative(cwd, file).replace(/\\/g, "/");
      if (matcher(relPath)) {
        matchedFiles.push(relPath);
      }
    }

    // Sort by path depth & length so top-level/shallow files appear first
    matchedFiles.sort((a, b) => {
      const depthA = a.split("/").length;
      const depthB = b.split("/").length;
      if (depthA !== depthB) return depthA - depthB;
      return a.length - b.length;
    });

    return matchedFiles.slice(0, maxResults);
  }

  private loadGitignoreRules(root: string): Set<string> {
    const rules = new Set<string>();
    const gitignorePath = join(root, ".gitignore");
    if (existsSync(gitignorePath)) {
      try {
        const lines = readFileSync(gitignorePath, "utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            rules.add(trimmed.replace(/\/$/, ""));
          }
        }
      } catch {}
    }
    return rules;
  }

  private collectFiles(
    dir: string,
    root: string,
    gitignoreRules: Set<string>,
    includePattern?: string
  ): string[] {
    const results: string[] = [];

    // If target is directly a single file
    try {
      const stat = statSync(dir);
      if (!stat.isDirectory()) {
        if (!this.isBinary(dir)) {
          results.push(dir);
        }
        return results;
      }
    } catch {
      return [];
    }

    const queue: string[] = [dir];

    while (queue.length > 0) {
      const currentDir = queue.shift()!;
      try {
        const entries = readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name);
          const relToRoot = relative(root, fullPath).replace(/\\/g, "/");

          if (this.isIgnored(entry.name, relToRoot, gitignoreRules)) {
            continue;
          }

          if (entry.isDirectory()) {
            queue.push(fullPath);
          } else if (entry.isFile()) {
            if (!this.isBinary(fullPath)) {
              if (includePattern) {
                const ext = extname(fullPath).toLowerCase();
                if (includePattern.startsWith("*") && ext === includePattern.slice(1)) {
                  results.push(fullPath);
                } else if (fullPath.includes(includePattern)) {
                  results.push(fullPath);
                }
              } else {
                results.push(fullPath);
              }
            }
          }
        }
      } catch {}
    }

    return results;
  }

  private isIgnored(name: string, relPath: string, gitignoreRules: Set<string>): boolean {
    if (DEFAULT_IGNORE_DIRS.has(name)) return true;
    if (name.startsWith(".") && name !== ".gitignore" && name !== ".env") return true;

    for (const rule of gitignoreRules) {
      if (name === rule || relPath === rule || relPath.startsWith(`${rule}/`)) {
        return true;
      }
      if (rule.startsWith("*") && name.endsWith(rule.slice(1))) {
        return true;
      }
    }

    return false;
  }

  private isBinary(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  }
}
