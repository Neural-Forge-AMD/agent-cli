import { describe, it, expect } from "bun:test";
import { requestUserInputTool, askQuestionTool } from "../src/tools/handlers/request-user-input";
import { promptUserQuestion } from "../src/cli/ui/prompt";
import { Session } from "../src/session/session";
import { ToolRouter } from "../src/tools/router";

describe("Interactive Questioning & Option Selection (Codex Elicitation / Claude Code ask_question)", () => {
  it("executes request_user_input and returns user response via requestInput callback", async () => {
    let capturedQuestion = "";
    let capturedOptions: string[] | undefined;

    const result = await requestUserInputTool.execute(
      {
        question: "Which database should we use?",
        options: ["(Recommended) PostgreSQL", "SQLite", "MongoDB"],
      },
      {
        cwd: process.cwd(),
        turnId: "turn_123",
        requestInput: async (q, opts) => {
          capturedQuestion = q;
          capturedOptions = opts;
          return "(Recommended) PostgreSQL";
        },
      }
    );

    expect(capturedQuestion).toBe("Which database should we use?");
    expect(capturedOptions).toEqual(["(Recommended) PostgreSQL", "SQLite", "MongoDB"]);
    expect(result.output).toBe('User responded: "(Recommended) PostgreSQL"');
    expect(result.isError).toBeFalsy();
  });

  it("executes ask_question alias tool cleanly", async () => {
    const result = await askQuestionTool.execute(
      {
        question: "Proceed with deleting legacy tests?",
        options: ["Yes, proceed", "No, abort"],
      },
      {
        cwd: process.cwd(),
        turnId: "turn_123",
        requestInput: async () => "Yes, proceed",
      }
    );

    expect(result.output).toBe('User responded: "Yes, proceed"');
  });

  it("handles fallback to requestApproval if requestInput is not provided", async () => {
    const result = await requestUserInputTool.execute(
      {
        question: "Deploy to production?",
        options: ["Yes", "No"],
      },
      {
        cwd: process.cwd(),
        turnId: "turn_123",
        requestApproval: async () => true,
      }
    );

    expect(result.output).toBe("User confirmed to proceed.");
  });

  it("promptUserQuestion fallback returns the first option in test / non-TTY mode", async () => {
    const answer = await promptUserQuestion({
      question: "Select preferred framework:",
      options: ["(Recommended) FastAPI", "Flask", "Django"],
    });

    expect(answer).toBe("(Recommended) FastAPI");
  });

  it("Session emits UserQuestionRequired and resolves with user answer", async () => {
    const router = new ToolRouter();
    router.register(requestUserInputTool);

    const session = new Session({
      tools: router,
    });

    let receivedQuestionEvent: any = null;
    session.onEvent((event) => {
      if (event.msg.type === "UserQuestionRequired") {
        receivedQuestionEvent = event.msg;
      }
    });

    const questionPromise = session.requestUserQuestion({
      questionId: "quest_test_1",
      turnId: "turn_test_1",
      question: "Should we run integration tests?",
      options: ["(Recommended) Yes", "No"],
    });

    expect(receivedQuestionEvent).toBeDefined();
    expect(receivedQuestionEvent.question).toBe("Should we run integration tests?");
    expect(receivedQuestionEvent.options).toEqual(["(Recommended) Yes", "No"]);

    session.resolveUserQuestion("quest_test_1", "(Recommended) Yes");
    const result = await questionPromise;

    expect(result).toBe("(Recommended) Yes");
  });
});
