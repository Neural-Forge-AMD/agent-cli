/**
 * Multi-Agent Tool Handlers for Groupy.
 * Exposes spawn_agent, wait_agent, send_input, close_agent, and list_agents.
 * 
 * Directly mirrors codex-rs/core/src/tools/handlers/multi_agents.rs.
 */

import type { Tool } from "../tools/types";
import type { ToolRouter } from "../tools/router";
import type { AgentSpawner } from "./spawner";

export function createMultiAgentTools(spawner: AgentSpawner): Tool[] {
  const spawnAgentTool: Tool = {
    name: "spawn_agent",
    description:
      "Spawn an independent parallel sub-agent to execute a specific sub-task in the background without blocking the main workflow.",
    parameters: {
      type: "object",
      properties: {
        task_name: {
          type: "string",
          description: "Unique name for the sub-agent task (lowercase, numbers, underscores).",
        },
        message: {
          type: "string",
          description: "Detailed instructions and context for the sub-agent to execute.",
        },
        role: {
          type: "string",
          description: "Specialized role: 'security-auditor', 'reviewer', 'researcher', 'tester', 'planner', or 'default'.",
          enum: ["default", "reviewer", "researcher", "tester", "planner", "security-auditor"],
        },
        model: {
          type: "string",
          description: "Optional model override. Defaults to inheriting parent model.",
        },
      },
      required: ["task_name", "message"],
    },
    async execute(args) {
      const taskName = String(args.task_name || "");
      const message = String(args.message || "");
      const role = args.role ? String(args.role) : undefined;
      const model = args.model ? String(args.model) : undefined;

      try {
        const handle = await spawner.spawnAgent({ taskName, message, role, model });
        return {
          output: `Successfully spawned sub-agent '${handle.id}' with role '${handle.role}' for task '${handle.taskName}' (status: ${handle.status}). Use 'wait_agent' to collect results.`,
        };
      } catch (err) {
        return {
          output: `Failed to spawn sub-agent: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };

  const waitAgentTool: Tool = {
    name: "wait_agent",
    description:
      "Wait for one or all spawned sub-agents to complete their background tasks and retrieve their final outputs.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Agent ID or task_name to wait for. Omit to wait for all currently running sub-agents.",
        },
        agent_id: {
          type: "string",
          description: "Alternative parameter for Agent ID to wait for.",
        },
        timeout_ms: {
          type: "number",
          description: "Maximum time to wait in milliseconds (default: 60000ms).",
        },
      },
    },
    async execute(args) {
      const target = args.target ? String(args.target) : (args.agent_id ? String(args.agent_id) : undefined);
      const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : 60000;

      try {
        const output = await spawner.waitAgent(target, timeoutMs);
        return { output };
      } catch (err) {
        return {
          output: `Error waiting for sub-agent: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };

  const sendInputTool: Tool = {
    name: "send_input",
    description: "Send a follow-up message or steering instructions to an existing sub-agent.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Agent ID or task_name of the target sub-agent.",
        },
        message: {
          type: "string",
          description: "Instructions or answer to send to the sub-agent.",
        },
        interrupt: {
          type: "boolean",
          description: "If true, immediately interrupts the sub-agent's current action before sending.",
        },
      },
      required: ["target", "message"],
    },
    async execute(args) {
      const target = String(args.target || "");
      const message = String(args.message || "");
      const interrupt = Boolean(args.interrupt);

      try {
        await spawner.sendInput(target, message, interrupt);
        return { output: `Successfully delivered message to sub-agent '${target}'.` };
      } catch (err) {
        return {
          output: `Failed to send input to sub-agent: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };

  const closeAgentTool: Tool = {
    name: "close_agent",
    description: "Terminate and clean up a running sub-agent.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Agent ID or task_name of the sub-agent to close.",
        },
      },
      required: ["target"],
    },
    async execute(args) {
      const target = String(args.target || "");
      const closed = await spawner.closeAgent(target);
      return {
        output: closed
          ? `Sub-agent '${target}' was shut down and removed.`
          : `Sub-agent '${target}' not found.`,
      };
    },
  };

  const listAgentsTool: Tool = {
    name: "list_agents",
    description: "List all spawned sub-agents and their current statuses.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      const agents = spawner.listAgents();
      if (agents.length === 0) {
        return { output: "No sub-agents currently spawned." };
      }
      return { output: JSON.stringify(agents, null, 2) };
    },
  };

  return [spawnAgentTool, waitAgentTool, sendInputTool, closeAgentTool, listAgentsTool];
}

/**
 * Register all multi-agent coordination tools into a ToolRouter
 */
export function registerMultiAgentTools(router: ToolRouter, spawner: AgentSpawner): void {
  for (const tool of createMultiAgentTools(spawner)) {
    router.register(tool);
  }
}
