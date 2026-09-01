/**
 * Auto-Memory LLM Tool Handlers (save_memory, read_memory, list_memories, remember).
 * Directly aligned with Anthropic Claude Code Auto-Memory specifications.
 */

import type { Tool } from "../tools/types";
import type { MemoryStore } from "./store";
import type { MemoryCategory } from "./types";

/**
 * Tool allowing the AI Agent to autonomously persist user preferences, corrections, and project context.
 */
export function createSaveMemoryTool(store: MemoryStore): Tool {
  return {
    name: "save_memory",
    description:
      "Save a persistent memory note to the project's Auto-Memory bank. Categories: 'user' (role, workflow style, tooling preferences), 'feedback' (user corrections, guidelines), 'project' (external context, environments, deadlines), 'reference' (links, issue trackers, dashboards). Do NOT save facts easily discovered in code or git history.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Category of memory: 'user', 'feedback', 'project', or 'reference'.",
          enum: ["user", "feedback", "project", "reference"],
        },
        name: {
          type: "string",
          description: "Short, descriptive snake_case identifier for this memory topic (e.g. 'testing_strategy', 'preferred_framework', 'staging_api').",
        },
        description: {
          type: "string",
          description: "One-line summary to display in the MEMORY.md index (e.g. 'Prefers Vitest without database mocks').",
        },
        content: {
          type: "string",
          description: "Detailed description of the fact, preference, or learned correction.",
        },
      },
      required: ["category", "name", "content"],
    },
    async execute(args, context) {
      const category = (args.category as MemoryCategory) || "project";
      const name = String(args.name || `topic_${Date.now()}`);
      const content = String(args.content || "").trim();
      const description = args.description ? String(args.description).trim() : undefined;

      if (!content) {
        return { output: "Error: memory content cannot be empty", isError: true };
      }

      const entry = store.saveTopicMemory({
        category,
        name,
        description,
        content,
        cwd: context.cwd,
      });

      return {
        output: `✓ Saved Auto-Memory topic: [${entry.category}] "${entry.name}" -> ${entry.filePath}`,
      };
    },
  };
}

/**
 * Tool allowing the AI Agent to retrieve the full contents of a specific topic memory file.
 */
export function createReadMemoryTool(store: MemoryStore): Tool {
  return {
    name: "read_memory",
    description:
      "Read the full details of a specific Auto-Memory topic file recorded in the project's memory index.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Name or filename of the memory topic to read (e.g. 'testing_strategy' or 'feedback_testing.md').",
        },
      },
      required: ["topic"],
    },
    async execute(args, context) {
      const topic = String(args.topic || "").trim();
      if (!topic) {
        return { output: "Error: topic name is required", isError: true };
      }

      const memory = store.readTopicMemory(topic, context.cwd);
      if (!memory) {
        return {
          output: `No memory topic found matching '${topic}' in this project.`,
          isError: true,
        };
      }

      return {
        output: `# Topic: ${memory.name} (${memory.type})\nModified: ${memory.modified}\n\n${memory.content}`,
      };
    },
  };
}

/**
 * Tool allowing the AI Agent to list all remembered topics for the active project.
 */
export function createListMemoriesTool(store: MemoryStore): Tool {
  return {
    name: "list_memories",
    description: "List all persistent memory topics and index for the current project repository.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(_args, context) {
      const topics = store.listProjectMemories(context.cwd);
      if (topics.length === 0) {
        return { output: "No persistent Auto-Memories have been recorded for this project yet." };
      }

      const lines = topics.map(
        (t) => `• [${t.type}] **${t.name}**: ${t.description || t.content.split("\n")[0]} (file: ${t.filePath})`
      );
      return { output: `Project Auto-Memories (${topics.length} topics):\n\n${lines.join("\n")}` };
    },
  };
}

/**
 * Backward-compatible remember tool.
 */
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
          enum: ["preference", "guideline", "architecture", "note", "user", "feedback", "project", "reference"],
        },
        content: {
          type: "string",
          description: "The concise rule, preference, or fact to remember permanently.",
        },
        name: {
          type: "string",
          description: "Optional topic name.",
        },
      },
      required: ["category", "content"],
    },
    async execute(args, context) {
      const category = (args.category as MemoryCategory) || "preference";
      const content = String(args.content || "");
      const name = args.name ? String(args.name) : undefined;

      if (!content) {
        return { output: "Error: memory content cannot be empty", isError: true };
      }

      const entry = store.addMemory({
        category,
        content,
        name,
        cwd: context.cwd,
      });

      return {
        output: `Successfully saved to Auto-Memory bank: [${entry.category}] "${entry.name || entry.content}"`,
      };
    },
  };
}

/**
 * Returns all Auto-Memory tools.
 */
export function createAutoMemoryTools(store: MemoryStore): Tool[] {
  return [
    createSaveMemoryTool(store),
    createReadMemoryTool(store),
    createListMemoriesTool(store),
    createRememberTool(store),
  ];
}
