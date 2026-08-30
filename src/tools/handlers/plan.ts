/**
 * Update Plan Tool Handler.
 * Live task checklist and progress plan tracking.
 * 
 * Directly mirrors codex-rs/core/src/tools/handlers/plan.rs and protocol/src/plan_tool.rs.
 */

import type { Tool, ToolContext, ToolExecutionResult } from "../types";
import type { PlanItem } from "../../protocol/events";

export interface UpdatePlanArgs {
  explanation?: string;
  plan: PlanItem[];
}

export const updatePlanTool: Tool = {
  name: "update_plan",
  description:
    "Update the live task checklist/progress plan for this turn. Give each step a concise description and current status (pending, in_progress, completed). Do not confuse with Plan Mode.",
  parameters: {
    type: "object",
    properties: {
      explanation: {
        type: "string",
        description: "Optional brief explanation of the plan update",
      },
      plan: {
        type: "array",
        description: "The list of steps and their current statuses",
        items: {
          type: "object",
          description: "A single task step",
          properties: {
            step: {
              type: "string",
              description: "Short description of the task step",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "Current status of the step",
            },
          },
          required: ["step", "status"],
        },
      },
    },
    required: ["plan"],
  },
  async execute(
    rawArgs: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolExecutionResult> {
    // 1. Guard against invocation in Plan Mode per Codex specification
    if (ctx.mode === "plan") {
      return {
        output:
          "update_plan cannot be called while in plan mode. In plan mode, present the plan in your response inside a <proposed_plan> block.",
        isError: true,
      };
    }

    const args = rawArgs as unknown as UpdatePlanArgs;
    if (!args.plan || !Array.isArray(args.plan)) {
      return {
        output: "Error: 'plan' must be a valid array of plan items with { step, status }.",
        isError: true,
      };
    }

    // Validate plan items
    for (const item of args.plan) {
      if (!item.step || !item.status) {
        return {
          output: "Error: Each plan item must have 'step' (string) and 'status' ('pending' | 'in_progress' | 'completed').",
          isError: true,
        };
      }
      if (!["pending", "in_progress", "completed"].includes(item.status)) {
        return {
          output: `Error: Invalid status '${item.status}'. Allowed values are 'pending', 'in_progress', 'completed'.`,
          isError: true,
        };
      }
    }

    // 2. Trigger onPlanUpdate callback to emit session event and render live progress in CLI
    if (ctx.onPlanUpdate) {
      ctx.onPlanUpdate(args.plan, args.explanation);
    }

    return {
      output: "Plan updated",
    };
  },
};
