/**
 * request_user_input tool handler.
 * Allows the agent to pause and ask the user a clarifying question or request feedback.
 * 
 * Mirrors codex-rs/core/src/tools/handlers/request_user_input.rs.
 */

import type { Tool, ToolContext, ToolExecutionResult } from "../types";

export const requestUserInputTool: Tool = {
  name: "request_user_input",
  description: "Ask the user a clarifying question or present options when instructions are ambiguous.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The specific question to ask the user." },
      options: {
        type: "array",
        description: "Optional list of choices for the user to select from.",
        items: { type: "string", description: "Choice text" },
      },
    },
    required: ["question"],
  },
  async execute(args, ctx): Promise<ToolExecutionResult> {
    const question = String(args.question || "");
    const options = Array.isArray(args.options) ? (args.options as string[]) : [];

    if (ctx.requestApproval) {
      const description = options.length > 0
        ? `${question}\nOptions: ${options.map((o, idx) => `${idx + 1}. ${o}`).join(", ")}`
        : question;

      const answered = await ctx.requestApproval(description);
      return {
        output: answered ? "User confirmed to proceed." : "User declined or requested alternative.",
      };
    }

    return {
      output: `Question sent to user: '${question}'. Waiting for input.`,
    };
  },
};
