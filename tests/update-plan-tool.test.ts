import { describe, it, expect } from "bun:test";
import { updatePlanTool } from "../src/tools/handlers/plan";
import type { ToolContext } from "../src/tools/types";
import type { PlanItem } from "../src/protocol/events";

describe("update_plan Tool Subsystem", () => {
  it("should successfully update plan with valid plan items", async () => {
    let capturedPlan: PlanItem[] = [];
    let capturedExplanation: string | undefined;

    const ctx: ToolContext = {
      cwd: process.cwd(),
      turnId: "turn_test_1",
      onPlanUpdate: (plan, explanation) => {
        capturedPlan = plan;
        capturedExplanation = explanation;
      },
    };

    const result = await updatePlanTool.execute(
      {
        explanation: "Refactoring authentication",
        plan: [
          { step: "Read auth config", status: "completed" },
          { step: "Update JWT expiry", status: "in_progress" },
          { step: "Run auth tests", status: "pending" },
        ],
      },
      ctx
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe("Plan updated");
    expect(capturedPlan.length).toBe(3);
    expect(capturedPlan[0]?.status).toBe("completed");
    expect(capturedPlan[1]?.status).toBe("in_progress");
    expect(capturedPlan[2]?.status).toBe("pending");
    expect(capturedExplanation).toBe("Refactoring authentication");
  });

  it("should reject invocation when session is in plan mode per Codex specification", async () => {
    const ctx: ToolContext = {
      cwd: process.cwd(),
      turnId: "turn_test_2",
      mode: "plan", // Explicit Plan Mode
    };

    const result = await updatePlanTool.execute(
      {
        plan: [{ step: "Some step", status: "pending" }],
      },
      ctx
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain(
      "update_plan cannot be called while in plan mode. In plan mode, present the plan in your response inside a <proposed_plan> block."
    );
  });

  it("should return error if plan array is missing or invalid", async () => {
    const ctx: ToolContext = {
      cwd: process.cwd(),
      turnId: "turn_test_3",
    };

    const result1 = await updatePlanTool.execute({}, ctx);
    expect(result1.isError).toBe(true);
    expect(result1.output).toContain("must be a valid array");

    const result2 = await updatePlanTool.execute(
      {
        plan: [{ step: "Step with bad status", status: "not_a_valid_status" }],
      },
      ctx
    );
    expect(result2.isError).toBe(true);
    expect(result2.output).toContain("Invalid status 'not_a_valid_status'");
  });
});
