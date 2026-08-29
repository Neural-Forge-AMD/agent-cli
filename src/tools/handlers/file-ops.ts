/**
 * Standard File Operations Tools.
 * read_file, write_file, list_dir.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Tool, ToolContext, ToolExecutionResult } from "../types";

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read the full text content of a file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative or absolute path to the file." },
    },
    required: ["path"],
  },
  async execute(args, ctx): Promise<ToolExecutionResult> {
    const filePath = resolve(ctx.cwd, String(args.path || ""));
    if (!existsSync(filePath)) {
      return { output: `Error: File not found: '${args.path}'`, isError: true };
    }
    try {
      const content = readFileSync(filePath, "utf8");
      return { output: content };
    } catch (err) {
      return { output: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
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
    const filePath = resolve(ctx.cwd, String(args.path || ""));
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, String(args.content ?? ""), "utf8");
      return { output: `Successfully wrote to '${args.path}'` };
    } catch (err) {
      return { output: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
