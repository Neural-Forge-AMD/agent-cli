/**
 * Multi-Agent Sub-agent Types & Lifecycle Definitions.
 * Directly mirrors codex-rs/core/src/agent/ and tools/handlers/multi_agents_spec.rs.
 */

import type { Session } from "../session/session";
import type { ToolRouter } from "../tools/router";
import type { AgentIdentity } from "./identity";

export type SubAgentStatus = "running" | "completed" | "interrupted" | "error";

export interface SpawnAgentParams {
  taskName: string;
  message: string;
  role?: string;
  model?: string;
  systemPrompt?: string;
  tools?: ToolRouter;
}

export interface SubAgentHandle {
  id: string;
  nickname: string;
  taskName: string;
  role: string;
  status: SubAgentStatus;
  createdAt: number;
  identity: AgentIdentity;
  session: Session;
  promise: Promise<string>;
  lastOutput?: string;
  error?: string;
}

export interface SubAgentSummary {
  id: string;
  nickname: string;
  taskName: string;
  role: string;
  status: SubAgentStatus;
  createdAt: number;
  agentRuntimeId: string;
  lastOutput?: string;
}
