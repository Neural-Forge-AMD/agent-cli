/**
 * Tool handler for remember allowing the LLM to store user preferences and repo conventions.
 */

import type { Tool } from "../tools/types";
import type { MemoryStore } from "./store";
import type { MemoryCategory } from "./types";

export function createRememberTool(store: MemoryStore): Tool {
  return {
    name: "remember",
    description:
      "Save a permanent user preference, coding guideline, or architectural convention to the persistent memory bank so it is remembered in all future sessions.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Category of the memory.",
          enum: ["preference", "guideline", "architecture", "note"],
        },
        content: {
          type: "string",
          description: "The concise rule, preference, or fact to remember permanently.",
        },
        scope: {
          type: "string",
          description: "'global' (applies to all projects) or 'workspace' (applies only to current repository). Defaults to 'global'.",
          enum: ["global", "workspace"],
        },
      },
      required: ["category", "content"],
    },
    async execute(args, context) {
      const category = (args.category as MemoryCategory) || "preference";
      const content = String(args.content || "");
      const scope = (args.scope as "global" | "workspace") || "global";

      if (!content) {
        return { output: "Error: memory content cannot be empty", isError: true };
      }

      const entry = store.addMemory({
        category,
        content,
        scope,
        cwd: context.cwd,
      });

      return {
        output: `Successfully saved to ${scope} memory bank: [${entry.category}] "${entry.content}"`,
      };
    },
  };
}
