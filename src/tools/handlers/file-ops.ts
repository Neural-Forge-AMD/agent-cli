/**
 * Standard File Operations Tools.
 * read_file, write_file, list_dir.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Tool, ToolContext, ToolExecutionResult } from "../types";

export const DEFAULT_MAX_UNPAGINATED_LINES = 250;

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read file content with surgical line-range support. Supports start_line and end_line to inspect specific sections of large files without exhausting token context.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative or absolute path to the file.",
      },
      start_line: {
        type: "number",
        description: "Optional 1-indexed line number to start reading from (e.g. 120).",
      },
      end_line: {
        type: "number",
        description: "Optional 1-indexed line number to end reading at, inclusive (e.g. 180).",
      },
      offset: {
        type: "number",
        description: "Alias for start_line (1-indexed).",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to read.",
      },
      line_numbers: {
        type: "boolean",
        description: "Whether to include line number prefixes ('<line>: <content>'). Defaults to true for range reads.",
      },
    },
    required: ["path"],
  },
  async execute(args, ctx): Promise<ToolExecutionResult> {
    const rawPath = String(args.path || "");
    const filePath = resolve(ctx.cwd, rawPath);
    if (!existsSync(filePath)) {
      return { output: `Error: File not found: '${rawPath}'`, isError: true };
    }
    try {
      const content = readFileSync(filePath, "utf8");
      const lines = content.split(/\r?\n/);
      const totalLines = lines.length;

      const hasRange =
        args.start_line !== undefined ||
        args.end_line !== undefined ||
        args.startLine !== undefined ||
        args.endLine !== undefined ||
        args.offset !== undefined ||
        args.limit !== undefined;

      // ponytail: if no range specified and small file, return raw content directly to keep existing tests & consumers zero-overhead
      if (!hasRange) {
        if (args.line_numbers === true) {
          const formatted = lines.map((l, idx) => `${idx + 1}: ${l}`).join("\n");
          return { output: formatted };
        }
        if (totalLines <= DEFAULT_MAX_UNPAGINATED_LINES) {
          return { output: content };
        }
        // Auto-truncate large unpaginated files to protect context window
        const truncated = lines.slice(0, DEFAULT_MAX_UNPAGINATED_LINES);
        const formatted = truncated.map((l, idx) => `${idx + 1}: ${l}`).join("\n");
        return {
          output: `[Showing lines 1 to ${DEFAULT_MAX_UNPAGINATED_LINES} of ${totalLines} in '${rawPath}']\n${formatted}\n\n[Truncated: ${totalLines - DEFAULT_MAX_UNPAGINATED_LINES} more lines. Use start_line=${DEFAULT_MAX_UNPAGINATED_LINES + 1} to continue reading.]`,
        };
      }

      // Range requested
      const startArg = args.start_line ?? args.startLine ?? args.offset;
      const start = Math.max(1, typeof startArg === "number" ? Math.floor(startArg) : 1);

      let end: number;
      const endArg = args.end_line ?? args.endLine;
      if (typeof endArg === "number") {
        end = Math.min(totalLines, Math.floor(endArg));
      } else if (typeof args.limit === "number") {
        end = Math.min(totalLines, start + Math.floor(args.limit) - 1);
      } else {
        end = Math.min(totalLines, start + DEFAULT_MAX_UNPAGINATED_LINES - 1);
      }

      if (start > totalLines) {
        return {
          output: `Error: start_line (${start}) exceeds total lines in file (${totalLines}).`,
          isError: true,
        };
      }

      if (end < start) {
        return {
          output: `Error: end_line (${end}) cannot be less than start_line (${start}).`,
          isError: true,
        };
      }

      const sliced = lines.slice(start - 1, end);
      const withNums = args.line_numbers !== false;
      const rendered = withNums
        ? sliced.map((l, idx) => `${start + idx}: ${l}`).join("\n")
        : sliced.join("\n");

      let notice = `[Showing lines ${start} to ${end} of ${totalLines} in '${rawPath}']\n${rendered}`;
      if (end < totalLines) {
        notice += `\n\n[File has ${totalLines} lines. To read further, use start_line=${end + 1}.]`;
      }

      return { output: notice };
    } catch (err) {
      return { output: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const viewFileTool: Tool = {
  ...readFileTool,
  name: "view_file",
  description:
    "View file content with surgical line-range support. Alias for read_file matching Antigravity & Claude Code conventions.",
};

export const listDirTool: Tool = {
  name: "list_dir",
  description: "List contents of a directory with file names and types.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path (defaults to current directory if omitted)." },
    },
  },
  async execute(args, ctx): Promise<ToolExecutionResult> {
    const dirPath = resolve(ctx.cwd, String(args.path || "."));
    if (!existsSync(dirPath)) {
      return { output: `Error: Directory not found: '${args.path}'`, isError: true };
    }
    try {
      const entries = readdirSync(dirPath);
      const formatted = entries.map((entry) => {
        const full = resolve(dirPath, entry);
        const isDir = statSync(full).isDirectory();
        return `${isDir ? "[DIR]" : "[FILE]"} ${entry}`;
      });
      return { output: formatted.join("\n") || "[Empty directory]" };
    } catch (err) {
      return { output: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Create a new file or completely overwrite an existing file with the given content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to write the file." },
      content: { type: "string", description: "Full text content to write." },
    },
    required: ["path", "content"],
  },
  async execute(args, ctx): Promise<ToolExecutionResult> {
    const rawPath = String(args.path || "");
    const filePath = resolve(ctx.cwd, rawPath);

    // Permission & Plan Mode verification
    if (ctx.execPolicy) {
      const evalResult = ctx.execPolicy.shouldPromptFileEdit(rawPath);
      if (evalResult.prompt && ctx.requestApproval) {
        const approval = await ctx.requestApproval(
          evalResult.reason || `Write file: ${rawPath}`,
          `write_file ${rawPath}`
        );
        const allowed = typeof approval === "object" ? approval.allowed : Boolean(approval);
        if (!allowed) {
          return {
            output: `[Plan Mode Gate]: File creation declined by user for '${rawPath}'. Please refine your implementation plan or ask the user for guidance.`,
            isError: true,
          };
        }
      } else if (evalResult.isPlanBlocked || ctx.mode === "plan") {
        return {
          output: `[Plan Mode Gate]: Cannot write or mutate '${rawPath}' while in Plan Mode without user approval. Please present your implementation plan first.`,
          isError: true,
        };
      }
    }

    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, String(args.content ?? ""), "utf8");
      ctx.onFileModified?.(rawPath);
      return { output: `Successfully wrote to '${args.path}'` };
    } catch (err) {
      return {
        output: `Failed to write file '${rawPath}': ${err instanceof Error ? err.message : String(err)}
[Systematic Error Recovery Checklist]:
1. Check directory permissions and ensure the path is valid within the workspace.
2. If the path contains non-existent nested folders, they should be auto-created.
3. Verify that the file is not locked by another active process.`,
        isError: true,
      };
    }
  },
};
