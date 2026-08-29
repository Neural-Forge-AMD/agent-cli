/**
 * LLM Tools for File Search and Grep.
 * Directly mirrors codex-rs/file-search and codex-rs/core/src/tools/handlers/grep.rs.
 */

import type { Tool } from "../tools/types";
import { FileSearchEngine } from "./engine";

export function createFileSearchTools(engine = new FileSearchEngine()): Tool[] {
  const grepSearchTool: Tool = {
    name: "grep_search",
    description:
      "Search for exact text patterns or regular expressions line-by-line across files in the workspace. Returns matching file paths, line numbers, and line contents.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The string or regular expression to search for.",
        },
        path: {
          type: "string",
          description: "Optional subdirectory or file path to search within. Defaults to current workspace root.",
        },
        is_regex: {
          type: "boolean",
          description: "Whether to treat query as a regular expression pattern. Default is false.",
        },
        case_sensitive: {
          type: "boolean",
          description: "Whether the search should be case sensitive. Default is false.",
        },
        include_pattern: {
          type: "string",
          description: "Optional filter for file extensions or names (e.g. '*.ts', '*.rs').",
        },
        max_results: {
          type: "number",
          description: "Maximum number of matching lines to return (default: 50).",
        },
      },
      required: ["query"],
    },
    async execute(args, context) {
      const query = String(args.query || "");
      if (!query.trim()) {
        return { output: "Error: query cannot be empty.", isError: true };
      }

      const path = args.path ? String(args.path) : undefined;
      const isRegex = Boolean(args.is_regex);
      const caseSensitive = Boolean(args.case_sensitive);
      const includePattern = args.include_pattern ? String(args.include_pattern) : undefined;
      const maxResults = typeof args.max_results === "number" ? args.max_results : 50;

      const result = engine.grep(context.cwd, {
        query,
        path,
        isRegex,
        caseSensitive,
        includePattern,
        maxResults,
      });

      if (result.matches.length === 0) {
        return { output: `No matches found for query: "${query}"` };
      }

      const formatted = result.matches
        .map((m) => `${m.file}:${m.lineNumber}: ${m.lineContent}`)
        .join("\n");

      let header = `Found ${result.totalMatches} match(es)${result.truncated ? ` (showing first ${result.matches.length})` : ""}:\n\n`;
      return { output: header + formatted };
    },
  };

  const findFilesTool: Tool = {
    name: "find_files",
    description:
      "Find files across the workspace matching a name or glob wildcard pattern (e.g. '*.test.ts', 'config.json', 'src/**/*.rs').",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Filename or wildcard pattern to search for (e.g. '*.ts', '*auth*').",
        },
        path: {
          type: "string",
          description: "Optional subdirectory to search within. Defaults to workspace root.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of files to return (default: 100).",
        },
      },
      required: ["pattern"],
    },
    async execute(args, context) {
      const pattern = String(args.pattern || "");
      if (!pattern.trim()) {
        return { output: "Error: pattern cannot be empty.", isError: true };
      }

      const path = args.path ? String(args.path) : undefined;
      const maxResults = typeof args.max_results === "number" ? args.max_results : 100;

      const files = engine.findFiles(context.cwd, {
        pattern,
        path,
        maxResults,
      });

      if (files.length === 0) {
        return { output: `No files found matching pattern: "${pattern}"` };
      }

      return { output: `Found ${files.length} file(s):\n` + files.join("\n") };
    },
  };

  return [grepSearchTool, findFilesTool];
}
