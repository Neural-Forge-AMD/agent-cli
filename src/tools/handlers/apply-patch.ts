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

    // Permission & Plan Mode verification
    if (ctx.execPolicy) {
      const evalResult = ctx.execPolicy.shouldPromptFileEdit(rawPath);
      if (evalResult.prompt && ctx.requestApproval) {
        const approval = await ctx.requestApproval(
          evalResult.reason || `Apply patch to: ${rawPath}`,
          `apply_patch ${rawPath}`
        );
        const allowed = typeof approval === "object" ? approval.allowed : Boolean(approval);
        if (!allowed) {
          return {
            output: `[Plan Mode Gate]: File modification declined by user for '${rawPath}'. Please refine your implementation plan or ask the user for guidance.`,
            isError: true,
          };
        }
      } else if (evalResult.isPlanBlocked || ctx.mode === "plan") {
        return {
          output: `[Plan Mode Gate]: Cannot mutate '${rawPath}' while in Plan Mode without user approval. Please present your implementation plan first.`,
          isError: true,
        };
      }
    }

    // Case 1: Creating a new file
    if (!existsSync(filePath)) {
      if (targetContent) {
        return {
          output: `Error: Target file '${rawPath}' does not exist, but targetContent was provided.
[Systematic Error Recovery Checklist]:
1. Root Cause: Trying to patch a non-existent file with targetContent.
2. Fix: For creating new files, leave 'targetContent' empty and provide full contents in 'replacementContent'.
3. Alternatively, check if the file path '${rawPath}' was mistyped.`,
          isError: true,
        };
      }
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, replacementContent, "utf8");
        ctx.onFileModified?.(rawPath);
        return { output: `Successfully created new file '${rawPath}'` };
      } catch (err) {
        return {
          output: `Failed to create file '${rawPath}': ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    }

    // Case 2: Modifying an existing file
    try {
      const originalFileContent = readFileSync(filePath, "utf8");

      if (!targetContent) {
        return {
          output: `Error: File '${rawPath}' already exists, but targetContent was empty.
[Systematic Error Recovery Checklist]:
1. Root Cause: An existing file requires targetContent to specify which lines to replace.
2. Fix: Call 'read_file' on '${rawPath}', extract the exact target lines, and provide them in 'targetContent'.
3. To overwrite the whole file, use the 'write_file' tool instead.`,
          isError: true,
        };
      }

      // Check occurrences with line-ending tolerance (handles Windows CRLF vs Unix LF seamlessly)
      let targetToFind = targetContent;
      let replacementToUse = replacementContent;
      const fileHasCrlf = originalFileContent.includes("\r\n");

      let firstIndex = originalFileContent.indexOf(targetToFind);
      if (firstIndex === -1 && fileHasCrlf) {
        // Try converting LF target to CRLF to match the file
        const crlfTarget = targetContent.replace(/\r?\n/g, "\r\n");
        firstIndex = originalFileContent.indexOf(crlfTarget);
        if (firstIndex !== -1) {
          targetToFind = crlfTarget;
          replacementToUse = replacementContent.replace(/\r?\n/g, "\r\n");
        }
      } else if (firstIndex === -1 && !fileHasCrlf && targetContent.includes("\r\n")) {
        // Try converting CRLF target to LF to match the file
        const lfTarget = targetContent.replace(/\r\n/g, "\n");
        firstIndex = originalFileContent.indexOf(lfTarget);
        if (firstIndex !== -1) {
          targetToFind = lfTarget;
          replacementToUse = replacementContent.replace(/\r\n/g, "\n");
        }
      }

      if (firstIndex === -1) {
        return {
          output: `Error: targetContent was not found in '${rawPath}'.
[Systematic Error Recovery Checklist]:
1. Root Cause: The snippet in targetContent does not match the actual file content (differences in whitespace, indentation, line endings, or prior edits).
2. Action: Call 'read_file' on '${rawPath}' to inspect current exact lines and indentation.
3. Fix: Provide the exact matching lines (including leading spaces) or wider context, then retry 'apply_patch'.`,
          isError: true,
        };
      }

      const secondIndex = originalFileContent.indexOf(targetToFind, firstIndex + 1);
      if (secondIndex !== -1) {
        return {
          output: `Error: targetContent matched multiple locations in '${rawPath}'.
[Systematic Error Recovery Checklist]:
1. Root Cause: targetContent is ambiguous and occurs multiple times in the file.
2. Action: Include 2-3 additional surrounding lines (before or after the target block) to make the target snippet uniquely identifiable.
3. Fix: Re-run 'apply_patch' with the extended unique block.`,
          isError: true,
        };
      }

      // Perform single unique replacement
      const newFileContent =
        originalFileContent.slice(0, firstIndex) +
        replacementToUse +
        originalFileContent.slice(firstIndex + targetToFind.length);

      writeFileSync(filePath, newFileContent, "utf8");
      ctx.onFileModified?.(rawPath);
      return {
        output: `Successfully applied patch to '${rawPath}'`,
      };
    } catch (err) {
      return {
        output: `Failed to apply patch to '${rawPath}': ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};
