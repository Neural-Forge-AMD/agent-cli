import { describe, expect, test, afterEach } from "bun:test";
import {
  Session,
  ModelClient,
  type ModelClientSession,
  type ModelSamplingParams,
  type StreamChunkEvent,
  AgentSpawner,
  AgentGraphStore,
  AgentRoleRegistry,
  ToolRouter,
  registerMultiAgentTools,
  createAgentIdentity,
  signTaskAction,
  verifyTaskAction,
} from "../src";

/**
 * Mock Model Client that answers based on sub-agent prompt
 */
class SubAgentMockModelClient extends ModelClient {
  newSession(): ModelClientSession {
    return {
      async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
        const lastUser = params.history.findLast((i) => i.type === "user_message");
        const query = lastUser?.type === "user_message" ? lastUser.content : "";

        if (query.includes("analyze_frontend")) {
          yield { type: "reasoning_delta", delta: "Analyzing frontend architecture..." };
          yield { type: "text_delta", delta: "Frontend analysis complete: React + Tailwind used." };
        } else if (query.includes("analyze_backend")) {
          yield { type: "reasoning_delta", delta: "Analyzing backend architecture..." };
          yield { type: "text_delta", delta: "Backend analysis complete: Bun + TypeScript used." };
        } else {
          yield { type: "text_delta", delta: `Task completed for: ${query}` };
        }
        yield { type: "done" };
      },
    };
  }
}

describe("Multi-Agent Sub-agent Spawner, Identity & Roles", () => {
  let mainSession: Session;
  let spawner: AgentSpawner;

  test("creates cryptographic AgentIdentity and signs/verifies task actions", () => {
    const parentIdentity = createAgentIdentity(undefined, "main-harness");
    expect(parentIdentity.agentRuntimeId).toMatch(/^aid_/);
    expect(parentIdentity.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(parentIdentity.privateKey).toContain("BEGIN PRIVATE KEY");

    const taskId = "task_verify_001";
    const payload = JSON.stringify({ action: "read_file", path: "src/index.ts" });

    // Sign payload
    const assertion = signTaskAction(parentIdentity, taskId, payload);
    expect(assertion.agentRuntimeId).toBe(parentIdentity.agentRuntimeId);
    expect(assertion.signature.length).toBeGreaterThan(20);

    // Verify valid signature
    const isValid = verifyTaskAction(assertion, payload);
    expect(isValid).toBe(true);

    // Tampered payload fails verification
    const isTamperedValid = verifyTaskAction(assertion, payload + " tampered");
    expect(isTamperedValid).toBe(false);
  });

  test("AgentGraphStore persists and traverses multi-agent parent/child hierarchy", () => {
    const graphStore = new AgentGraphStore(":memory:");

    // Root -> Child1, Child2
    graphStore.upsertEdge("thread_root", "thread_child_1", "open");
    graphStore.upsertEdge("thread_root", "thread_child_2", "open");

    // Child1 -> Grandchild1
    graphStore.upsertEdge("thread_child_1", "thread_grandchild_1", "open");

    const directChildren = graphStore.listChildren("thread_root");
    expect(directChildren.length).toBe(2);
    expect(directChildren).toContain("thread_child_1");
    expect(directChildren).toContain("thread_child_2");

    const descendants = graphStore.listDescendants("thread_root");
    expect(descendants.length).toBe(3);
    expect(descendants).toContain("thread_child_1");
    expect(descendants).toContain("thread_child_2");
    expect(descendants).toContain("thread_grandchild_1");

    // Update status
    graphStore.setEdgeStatus("thread_child_2", "closed");
    const openChildren = graphStore.listChildren("thread_root", "open");
    expect(openChildren.length).toBe(1);
    expect(openChildren[0]).toBe("thread_child_1");

    graphStore.close();
  });

  test("AgentRoleRegistry supports custom nickname candidates [Pikaa, Heca, Bankli, Moli]", () => {
    const registry = new AgentRoleRegistry();
    const defaultRole = registry.getRole("default");

    expect(defaultRole).toBeDefined();
    expect(defaultRole?.nicknameCandidates).toBeDefined();

    const nick1 = registry.pickNickname("default", 1);
    const nick2 = registry.pickNickname("default", 2);
    expect(["Pikaa", "Heca", "Bankli", "Moli"]).toContain(nick1);
    expect(["Pikaa", "Heca", "Bankli", "Moli"]).toContain(nick2);
  });

  test("spawns multiple independent sub-agents with nicknames & cryptographic provenance", async () => {
    const modelClient = new SubAgentMockModelClient();
    const graphStore = new AgentGraphStore(":memory:");
    mainSession = new Session({ threadId: "thread_main_session", modelClient });
    spawner = new AgentSpawner(mainSession, undefined, undefined, graphStore);

    // Spawn Sub-Agent 1 (Researcher)
    const agent1 = await spawner.spawnAgent({
      taskName: "frontend_task",
      role: "researcher",
      message: "Please analyze_frontend",
    });

    // Spawn Sub-Agent 2 (Tester)
    const agent2 = await spawner.spawnAgent({
      taskName: "backend_task",
      role: "tester",
      message: "Please analyze_backend",
    });

    expect(agent1.id).toContain("frontend_task");
    expect(agent1.agentRuntimeId).toMatch(/^aid_/);

    expect(agent2.id).toContain("backend_task");
    expect(agent2.agentRuntimeId).toMatch(/^aid_/);

    expect(spawner.listAgents().length).toBe(2);

    // Verify edge recorded in graphStore
    const children = graphStore.listChildren("thread_main_session");
    expect(children.length).toBe(2);
    expect(children).toContain(agent1.id);
    expect(children).toContain(agent2.id);

    // Wait for sub-agents to finish
    const output1 = await spawner.waitAgent(agent1.id, 5000);
    const output2 = await spawner.waitAgent(agent2.id, 5000);

    expect(output1).toContain("React + Tailwind");
    expect(output2).toContain("Bun + TypeScript");

    graphStore.close();
  });

  test("interacts with sub-agents via registered ToolRouter multi-agent tools", async () => {
    const modelClient = new SubAgentMockModelClient();
    const graphStore = new AgentGraphStore(":memory:");
    mainSession = new Session({ threadId: "thread_router_test", modelClient });
    spawner = new AgentSpawner(mainSession, undefined, undefined, graphStore);

    const router = new ToolRouter();
    registerMultiAgentTools(router, spawner);

    expect(router.has("spawn_agent")).toBe(true);
    expect(router.has("wait_agent")).toBe(true);
    expect(router.has("send_input")).toBe(true);
    expect(router.has("list_agents")).toBe(true);
    expect(router.has("close_agent")).toBe(true);

    // 1. Spawn via ToolRouter
    const spawnRes = await router.execute(
      "spawn_agent",
      { task_name: "db_audit", role: "reviewer", message: "Audit database connections" },
      { cwd: process.cwd(), turnId: "t1" }
    );
    expect(spawnRes.isError).toBeFalsy();
    expect(spawnRes.output).toContain("Successfully spawned sub-agent");

    // 2. Wait via ToolRouter
    const agentHandle = spawner.listAgents()[0];
    expect(agentHandle).toBeDefined();

    const waitRes = await router.execute(
      "wait_agent",
      { agent_id: agentHandle?.id },
      { cwd: process.cwd(), turnId: "t1" }
    );
    expect(waitRes.isError).toBeFalsy();
    expect(waitRes.output).toContain("Audit database connections");

    graphStore.close();
  });
});
