import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Session } from "../src/session/session";
import { createDefaultTools } from "../src/tools";
import { SkillsLoader } from "../src/skills/loader";
import { MemoryStore } from "../src/memories/store";
import { AgentSpawner } from "../src/agents/spawner";
import { registerMultiAgentTools } from "../src/agents/tools";
import { ModelClient } from "../src/client/model-client";
import type { ModelClientSession, ModelSamplingParams, StreamChunkEvent } from "../src/client/types";

describe("Autonomous Skills & Sub-Agent Delegation (Antigravity/Claude Code pattern)", () => {
  let testDir: string;
  let skillsLoader: SkillsLoader;
  let memoryStore: MemoryStore;

  beforeEach(() => {
    testDir = join(tmpdir(), `pikaa_auto_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    skillsLoader = new SkillsLoader({ includeGlobal: false, includeBuiltIn: true });
    memoryStore = new MemoryStore();
  });

  afterEach(() => {
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("should allow LLM to autonomously load domain skills via load_skill during ReAct loop", async () => {
    const tools = createDefaultTools({ skillsLoader, memoryStore });

    class MockSkillModelClient extends ModelClient {
      override newSession(): ModelClientSession {
        return {
          async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
            const lastItem = params.history[params.history.length - 1];

            if (lastItem && lastItem.type === "function_call_output") {
              yield {
                type: "text_delta",
                delta: "I have loaded systematic-debugging and will apply Phase 1: Root Cause Investigation.",
              };
              yield { type: "done" };
              return;
            }

            yield {
              type: "tool_call",
              callId: "call_skill_1",
              name: "load_skill",
              arguments: { skill_name: "systematic-debugging" },
            };
            yield { type: "done" };
          },
        };
      }
    }

    const session = new Session({
      cwd: testDir,
      tools,
      skillsLoader,
      memoryStore,
      modelClient: new MockSkillModelClient(),
    });

    let completedText = "";
    session.onEvent((event) => {
      if (event.msg.type === "AgentMessageDelta") {
        completedText += event.msg.delta;
      }
    });

    await session.prompt("There is a bug in user auth. Help me debug it.");

    await new Promise<void>((resolve) => {
      const unsub = session.onEvent((evt) => {
        if (evt.msg.type === "TurnCompleted") {
          unsub();
          resolve();
        }
      });
    });

    expect(completedText).toContain("systematic-debugging");
    expect(completedText).toContain("Phase 1: Root Cause Investigation");

    const history = session.getHistory();
    const funcCall = history.find((i) => i.type === "function_call" && (i as any).name === "load_skill");
    const funcOutput = history.find((i) => i.type === "function_call_output" && (i as any).callId === "call_skill_1");

    expect(funcCall).toBeDefined();
    expect(funcOutput).toBeDefined();
    expect((funcOutput as any).output).toContain("Systematic Debugging");
  });

  it("should allow LLM to autonomously spawn and wait for a specialized security sub-agent", async () => {
    const tools = createDefaultTools({ skillsLoader, memoryStore });
    let capturedAgentId = "";

    class MockOrchestratorClient extends ModelClient {
      override newSession(): ModelClientSession {
        return {
          async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
            const lastItem = params.history[params.history.length - 1];

            if (lastItem && lastItem.type === "function_call_output") {
              const match = lastItem.output?.match(/sub-agent '([^']+)'/i);
              if (match) {
                capturedAgentId = match[1];

                yield {
                  type: "tool_call",
                  callId: "call_wait_1",
                  name: "wait_agent",
                  arguments: { agent_id: capturedAgentId },
                };
                yield { type: "done" };
                return;
              }

              // After wait_agent finishes
              yield {
                type: "text_delta",
                delta: `Sub-agent ${capturedAgentId} finished audit. No vulnerabilities found in auth tokens.`,
              };
              yield { type: "done" };
              return;
            }

            // Step 1: spawn security-auditor sub-agent
            yield {
              type: "tool_call",
              callId: "call_spawn_1",
              name: "spawn_agent",
              arguments: {
                task_name: "audit_auth_tokens",
                message: "Scan src/auth for token leaks and weak HMAC secrets.",
                role: "security-auditor",
              },
            };
            yield { type: "done" };
          },
        };
      }
    }

    const session = new Session({
      cwd: testDir,
      tools,
      skillsLoader,
      memoryStore,
      modelClient: new MockOrchestratorClient(),
    });

    const spawner = new AgentSpawner(session);
    registerMultiAgentTools(tools, spawner);

    let finalAnswer = "";
    session.onEvent((event) => {
      if (event.msg.type === "AgentMessageDelta") {
        finalAnswer += event.msg.delta;
      }
    });

    await session.prompt("Audit the authentication token security");

    await new Promise<void>((resolve) => {
      const unsub = session.onEvent((evt) => {
        if (evt.msg.type === "TurnCompleted") {
          unsub();
          resolve();
        }
      });
    });

    expect(capturedAgentId).toBeTruthy();
    expect(finalAnswer).toContain("finished audit");
    expect(finalAnswer).toContain("No vulnerabilities found");

    const history = session.getHistory();
    const spawnCall = history.find((i) => i.type === "function_call" && (i as any).name === "spawn_agent");
    const waitCall = history.find((i) => i.type === "function_call" && (i as any).name === "wait_agent");

    expect(spawnCall).toBeDefined();
    expect(waitCall).toBeDefined();
  });
});
