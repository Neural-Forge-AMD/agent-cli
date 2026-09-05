import { describe, expect, test } from "bun:test";
import {
  Session,
  ModelClient,
  type ModelClientSession,
  type ModelSamplingParams,
  type StreamChunkEvent,
  AgentSpawner,
  AgentGraphStore,
  ToolRouter,
  registerMultiAgentTools,
} from "../src";

class SimpleMockClient extends ModelClient {
  constructor(private responseText = "Done") {
    super();
  }

  newSession(): ModelClientSession {
    const text = this.responseText;
    return {
      async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
        yield { type: "text_delta", delta: text };
        yield { type: "done" };
      },
    };
  }
}

describe("Sub-Agent Resource Limits and Memory Management", () => {
  test("enforces maxConcurrentAgents limit on parallel sub-agents", async () => {
    const graphStore = new AgentGraphStore(":memory:");
    const mainSession = new Session({
      threadId: "session_concurrency_test",
      modelClient: new SimpleMockClient(),
    });

    const spawner = new AgentSpawner(
      mainSession,
      undefined,
      undefined,
      graphStore,
      { maxConcurrentAgents: 2 }
    );

    // Spawn 2 sub-agents (limit is 2)
    const a1 = await spawner.spawnAgent({ taskName: "task_1", message: "work 1" });
    const a2 = await spawner.spawnAgent({ taskName: "task_2", message: "work 2" });
    expect(a1.id).toBeDefined();
    expect(a2.id).toBeDefined();

    // Attempting to spawn 3rd concurrent sub-agent should throw GroupyError
    let thrownError: any = null;
    try {
      await spawner.spawnAgent({ taskName: "task_3", message: "work 3" });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError.message).toContain("Maximum concurrent sub-agents limit (2) reached");

    // Wait for tasks to finish before closing
    await spawner.waitAgent(a1.id, 5000);
    await spawner.waitAgent(a2.id, 5000);
    graphStore.close();
  });

  test("enforces recursion depth guard and prevents infinite nesting", async () => {
    const graphStore = new AgentGraphStore(":memory:");
    const mainSession = new Session({
      threadId: "session_recursion_test",
      modelClient: new SimpleMockClient(),
    });

    // Spawner at max depth
    const maxDepthSpawner = new AgentSpawner(
      mainSession,
      undefined,
      undefined,
      graphStore,
      { maxDepth: 1 },
      1 // depth is 1, which equals maxDepth
    );

    let depthError: any = null;
    try {
      await maxDepthSpawner.spawnAgent({ taskName: "nested_task", message: "nested" });
    } catch (err) {
      depthError = err;
    }

    expect(depthError).toBeDefined();
    expect(depthError.message).toContain("Recursion limit exceeded: Maximum sub-agent nesting depth (1) reached");

    graphStore.close();
  });

  test("strips recursive multi-agent tools for sub-agents at max depth threshold", async () => {
    const graphStore = new AgentGraphStore(":memory:");
    const parentTools = new ToolRouter();
    const mainSession = new Session({
      threadId: "session_tool_strip_test",
      modelClient: new SimpleMockClient(),
      tools: parentTools,
    });

    // Max depth 1 means any child (depth 1) reaches maxDepth
    const spawner = new AgentSpawner(
      mainSession,
      undefined,
      undefined,
      graphStore,
      { maxDepth: 1 },
      0
    );
    registerMultiAgentTools(parentTools, spawner);
    expect(parentTools.has("spawn_agent")).toBe(true);

    // Spawn child (depth becomes 1, and 1 >= maxDepth 1)
    const childSummary = await spawner.spawnAgent({
      taskName: "child_agent",
      message: "do something",
    });

    const childHandle = spawner.getAgent(childSummary.id);
    expect(childHandle).toBeDefined();
    // Child session tools must NOT include spawn_agent
    expect(childHandle?.session.tools.has("spawn_agent")).toBe(false);

    await spawner.waitAgent(childSummary.id, 5000);
    graphStore.close();
  });

  test("enforces token budget limit and aborts runaway sub-agents", async () => {
    class VerboseStreamClient extends ModelClient {
      newSession(): ModelClientSession {
        return {
          async *stream(): AsyncIterable<StreamChunkEvent> {
            // Emit huge volume of text
            yield { type: "text_delta", delta: "A".repeat(800) };
            yield { type: "done" };
          },
        };
      }
    }

    const graphStore = new AgentGraphStore(":memory:");
    const mainSession = new Session({
      threadId: "session_token_budget_test",
      modelClient: new VerboseStreamClient(),
    });

    const spawner = new AgentSpawner(mainSession, undefined, undefined, graphStore);

    // Spawn agent with tiny token budget of 50 tokens (~200 chars)
    const child = await spawner.spawnAgent({
      taskName: "heavy_task",
      message: "generate text",
      maxTokens: 50,
    });

    let waitError: any = null;
    try {
      await spawner.waitAgent(child.id, 5000);
    } catch (err) {
      waitError = err;
    }

    expect(waitError).toBeDefined();
    expect(waitError.message).toContain("Token budget limit exceeded");

    graphStore.close();
  });

  test("prunes completed agents to eliminate long-running memory leaks", async () => {
    const graphStore = new AgentGraphStore(":memory:");
    const mainSession = new Session({
      threadId: "session_leak_test",
      modelClient: new SimpleMockClient("Short answer"),
    });

    // Set maxRetainedCompleted to 2
    const spawner = new AgentSpawner(
      mainSession,
      undefined,
      undefined,
      graphStore,
      { maxRetainedCompleted: 2, maxConcurrentAgents: 10 }
    );

    // Spawn 4 sub-agents sequentially
    for (let i = 1; i <= 4; i++) {
      const a = await spawner.spawnAgent({ taskName: `task_${i}`, message: `run ${i}` });
      await spawner.waitAgent(a.id, 5000);
    }

    // Should retain at most 2 completed agents in memory
    const list = spawner.listAgents();
    expect(list.length).toBeLessThanOrEqual(2);

    // Manual removal
    const firstRemaining = list[0];
    if (firstRemaining) {
      const removed = spawner.removeAgent(firstRemaining.id);
      expect(removed).toBe(true);
      expect(spawner.getAgent(firstRemaining.id)).toBeUndefined();
    }

    // Clear completed
    const cleared = spawner.clearCompleted();
    expect(spawner.listAgents().length).toBe(0);

    graphStore.close();
  });
});
