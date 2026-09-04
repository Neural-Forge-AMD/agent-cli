import { describe, expect, test } from "bun:test";
import { Session } from "../src/session/session";
import {
  ModelClient,
  type ModelClientSession,
  type ModelSamplingParams,
  type StreamChunkEvent,
} from "../src/client/model-client";
import { ToolRouter } from "../src/tools/router";

class MockParallelToolModelClient extends ModelClient {
  public capturedMessages: any[] = [];
  private turnCounter = 0;

  newSession(): ModelClientSession {
    const parent = this;
    return {
      async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
        parent.turnCounter++;
        parent.capturedMessages = params.history;

        if (parent.turnCounter === 1) {
          // Model emits text and TWO tool calls in parallel
          yield { type: "text_delta", delta: "Inspecting files in parallel..." };
          yield {
            type: "tool_call",
            callId: "call_read_1",
            name: "test_tool_a",
            arguments: { param: "A" },
          };
          yield {
            type: "tool_call",
            callId: "call_read_2",
            name: "test_tool_b",
            arguments: { param: "B" },
          };
          yield { type: "done", inputTokens: 50, outputTokens: 30 };
        } else {
          // Model concludes after receiving tool outputs
          yield { type: "text_delta", delta: "All parallel tasks completed." };
          yield { type: "done", inputTokens: 40, outputTokens: 10 };
        }
      },
    };
  }
}

describe("Parallel Tool Call History & Schema Compliance Subsystem", () => {
  test("groups consecutive function_calls and contiguous outputs for strict OpenAI spec compliance", async () => {
    const mockClient = new MockParallelToolModelClient();
    const router = new ToolRouter();

    router.register({
      name: "test_tool_a",
      description: "Test tool A",
      parameters: { type: "object", properties: { param: { type: "string", description: "p" } } },
      async execute(args) {
        return { output: `Result A: ${args.param}` };
      },
    });

    router.register({
      name: "test_tool_b",
      description: "Test tool B",
      parameters: { type: "object", properties: { param: { type: "string", description: "p" } } },
      async execute(args) {
        return { output: `Result B: ${args.param}` };
      },
    });

    const session = new Session({
      modelClient: mockClient,
      tools: router,
      autoVerification: false,
    });

    await session.promptAndWait("Run tasks in parallel");

    const history = session.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(6);

    // Find the sequence of items in history
    const agentMsgIdx = history.findIndex(
      (h) => h.type === "agent_message" && (h as any).content.includes("Inspecting files in parallel")
    );
    expect(agentMsgIdx).toBeGreaterThan(-1);

    // Next two items MUST be the two function_call items consecutively
    expect(history[agentMsgIdx + 1]?.type).toBe("function_call");
    expect((history[agentMsgIdx + 1] as any).callId).toBe("call_read_1");

    expect(history[agentMsgIdx + 2]?.type).toBe("function_call");
    expect((history[agentMsgIdx + 2] as any).callId).toBe("call_read_2");

    // Followed by the two function_call_output items
    expect(history[agentMsgIdx + 3]?.type).toBe("function_call_output");
    expect((history[agentMsgIdx + 3] as any).callId).toBe("call_read_1");
    expect((history[agentMsgIdx + 3] as any).output).toBe("Result A: A");

    expect(history[agentMsgIdx + 4]?.type).toBe("function_call_output");
    expect((history[agentMsgIdx + 4] as any).callId).toBe("call_read_2");
    expect((history[agentMsgIdx + 4] as any).output).toBe("Result B: B");

    // Finally the concluding agent message
    expect(history[agentMsgIdx + 5]?.type).toBe("agent_message");
    expect((history[agentMsgIdx + 5] as any).content).toBe("All parallel tasks completed.");
  });
});
