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
  maxTokens?: number;
  maxIterations?: number;
}

export interface AgentSpawnerOptions {
  maxConcurrentAgents?: number;
  maxDepth?: number;
  maxRetainedCompleted?: number;
  defaultTokenBudget?: number;
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
  depth?: number;
  tokenBudget?: number;
  totalTokens?: number;
  resolvePromise?: (output: string) => void;
  rejectPromise?: (err: Error) => void;
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
  depth?: number;
  tokenBudget?: number;
  totalTokens?: number;
}
