/**
 * apply_patch tool handler.
 * Implements surgical multi-line code replacement.
 * 
 * Directly mirrors codex-rs/core/src/tools/handlers/apply_patch.rs.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { Tool, ToolContext, ToolExecutionResult } from "../types";

export const applyPatchTool: Tool = {
  name: "apply_patch",
  description:
    "Apply precise multi-line modifications to an existing file or create a new file. TargetContent must match the file content exactly.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative or absolute path to the target file",
      },
      targetContent: {
        type: "string",
        description:
          "The exact block of code in the file to be replaced. For creating a new file, leave this empty.",
      },
      replacementContent: {
        type: "string",
        description: "The new code content to replace the targetContent with.",
      },
    },
    required: ["path", "replacementContent"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolExecutionResult> {
    const rawPath = String(args.path || "");
    if (!rawPath) {
      return { output: "Error: 'path' parameter is required", isError: true };
    }

    const filePath = resolve(ctx.cwd, rawPath);
    const targetContent = typeof args.targetContent === "string" ? args.targetContent : "";
    const replacementContent = String(args.replacementContent ?? "");

    // Case 1: Creating a new file
    if (!existsSync(filePath)) {
      if (targetContent) {
        return {
          output: `Error: Target file '${rawPath}' does not exist, but targetContent was provided.`,
          isError: true,
        };
      }
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, replacementContent, "utf8");
        return { output: `Successfully created new file '${rawPath}'` };
      } catch (err) {
        return {
          output: `Failed to create file: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    }

    // Case 2: Modifying an existing file
    try {
      const originalFileContent = readFileSync(filePath, "utf8");

      if (!targetContent) {
        return {
          output: `Error: File '${rawPath}' already exists. Specify targetContent to replace specific lines or use overwrite.`,
          isError: true,
        };
      }

      // Check occurrences
      const firstIndex = originalFileContent.indexOf(targetContent);
      if (firstIndex === -1) {
        return {
          output: `Error: targetContent was not found in '${rawPath}'. Please verify file contents before editing.`,
          isError: true,
        };
      }

      const secondIndex = originalFileContent.indexOf(targetContent, firstIndex + 1);
      if (secondIndex !== -1) {
        return {
          output: `Error: targetContent matched multiple locations in '${rawPath}'. Provide more surrounding context lines to ensure uniqueness.`,
          isError: true,
        };
      }

      // Perform single unique replacement
      const newFileContent =
        originalFileContent.slice(0, firstIndex) +
        replacementContent +
        originalFileContent.slice(firstIndex + targetContent.length);

      writeFileSync(filePath, newFileContent, "utf8");
      return {
        output: `Successfully applied patch to '${rawPath}'`,
      };
    } catch (err) {
      return {
        output: `Failed to apply patch: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};
