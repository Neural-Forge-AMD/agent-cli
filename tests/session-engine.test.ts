import { describe, expect, test } from "bun:test";
import {
  Session,
  ModelClient,
  type ModelClientSession,
  type ModelSamplingParams,
  type StreamChunkEvent,
  ToolRouter,
  type Tool,
  type Event,
} from "../src";

/**
 * Mock Model Client that simulates:
 * Turn 1: Reasoning + Tool Call (add_numbers)
 * Turn 2: Final Text Response
 */
class MockAgentModelClient extends ModelClient {
  newSession(): ModelClientSession {
    return {
      async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
        const lastItem = params.history[params.history.length - 1];

        // If the last item was a tool output, return final answer
        if (lastItem && lastItem.type === "function_call_output") {
          yield {
            type: "reasoning_delta",
            delta: "Received calculation result. Formulating answer.",
          };
          yield {
            type: "text_delta",
            delta: `The calculated result is ${lastItem.output}.`,
          };
          yield { type: "done" };
          return;
        }

        // Otherwise, emit reasoning and call tool
        yield {
          type: "reasoning_delta",
          delta: "User asked for addition. I should call the add_numbers tool.",
        };
        yield {
          type: "tool_call",
          callId: "call_add_1",
          name: "add_numbers",
          arguments: { a: 15, b: 25 },
        };
        yield { type: "done" };
      },
    };
  }
}

describe("Groupy Core Engine Lifecycle", () => {
  test("runs a complete ReAct turn with reasoning, tool calling, and final message", async () => {
    const tools = new ToolRouter();
    const addTool: Tool = {
      name: "add_numbers",
      description: "Add two numbers together",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number", description: "First number" },
          b: { type: "number", description: "Second number" },
        },
        required: ["a", "b"],
      },
      async execute(args) {
        const a = Number(args.a);
        const b = Number(args.b);
        return { output: String(a + b) };
      },
    };
    tools.register(addTool);

    const receivedEvents: Event[] = [];
    const mockClient = new MockAgentModelClient();
    const session = new Session({
      model: "mock-model",
      tools,
      modelClient: mockClient,
      onEvent: (evt) => {
        receivedEvents.push(evt);
      },
    });

    // Submit prompt
    const submission = await session.prompt("Please add 15 and 25");
    expect(submission.kind).toBe("started");
    expect(submission.turnId).toBeDefined();

    // Wait until turn completes
    await new Promise<void>((resolve) => {
      const unsub = session.onEvent((evt) => {
        if (evt.msg.type === "TurnCompleted") {
          unsub();
          resolve();
        }
      });
    });

    // Verify conversation history
    const history = session.getHistory();
    expect(history.length).toBe(4);
    expect(history[0]?.type).toBe("user_message");
    expect(history[1]?.type).toBe("function_call");
    expect(history[2]?.type).toBe("function_call_output");
    expect((history[2] as any).output).toBe("40");
    expect(history[3]?.type).toBe("agent_message");
    expect((history[3] as any).content).toContain("40");

    // Verify event stream lifecycle
    const eventTypes = receivedEvents.map((e) => e.msg.type);
    expect(eventTypes).toContain("SessionConfigured");
    expect(eventTypes).toContain("StatusChanged");
    expect(eventTypes).toContain("TurnStarted");
    expect(eventTypes).toContain("ReasoningDelta");
    expect(eventTypes).toContain("ItemStarted");
    expect(eventTypes).toContain("ItemCompleted");
    expect(eventTypes).toContain("AgentMessageDelta");
    expect(eventTypes).toContain("TurnCompleted");
  });
});
