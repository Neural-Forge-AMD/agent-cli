/**
 * request_user_input & ask_question tool handlers.
 * Allows the agent to pause and ask the user clarifying questions with interactive selectable options.
 * 
 * Mirrors codex-rs/core/src/elicitation.rs and Claude Code ask_question.
 */

import type { Tool, ToolContext, ToolExecutionResult } from "../types";

export const requestUserInputTool: Tool = {
  name: "request_user_input",
  description:
    "Ask the user a clarifying question or present multiple-choice options when instructions are ambiguous. You can include recommendations prefixing choices with '(Recommended)'.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The specific question to ask the user." },
      options: {
        type: "array",
        description: "Optional list of choices for the user to select from (e.g. ['(Recommended) Option A', 'Option B']).",
        items: { type: "string", description: "Choice text" },
      },
    },
    required: ["question"],
  },
  async execute(args, ctx): Promise<ToolExecutionResult> {
    const question = String(args.question || "");
    const options = Array.isArray(args.options) ? (args.options as string[]) : [];

    if (ctx.requestInput) {
      const answer = await ctx.requestInput(question, options);
      return {
        output: `User responded: "${answer}"`,
      };
    }

    if (ctx.requestApproval) {
      const description = options.length > 0
        ? `${question}\nOptions:\n${options.map((o, idx) => `  [${idx + 1}] ${o}`).join("\n")}`
        : question;

      const answered = await ctx.requestApproval(description);
      return {
        output: answered ? "User confirmed to proceed." : "User declined or requested alternative.",
      };
    }

    return {
      output: `Question presented to user: '${question}' with options [${options.join(", ")}].`,
    };
  },
};

export const askQuestionTool: Tool = {
  ...requestUserInputTool,
  name: "ask_question",
};
