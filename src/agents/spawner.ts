/**
 * AgentSpawner - Coordinates spawning, tracking, communicating, and waiting
 * on independent parallel sub-agents with cryptographic identity, role specialization,
 * and persisted parent/child graph topology.
 * 
 * Directly mirrors codex-rs/core/src/agent/, agent-identity, agent-roles, and agent-graph-store.
 */

import { Session } from "../session/session";
import type { SpawnAgentParams, SubAgentHandle, SubAgentSummary } from "./types";
import { AgentRoleRegistry } from "./roles";
import { createAgentIdentity, type AgentIdentity } from "./identity";
import { AgentGraphStore } from "./graph-store";
import { GroupyError } from "../protocol/errors";

export class AgentSpawner {
  private subAgents = new Map<string, SubAgentHandle>();
  private nextAgentId = 1;
  public readonly roleRegistry: AgentRoleRegistry;
  public readonly parentIdentity: AgentIdentity;
  public readonly graphStore: AgentGraphStore;

  constructor(
    private parentSession: Session,
    roleRegistry?: AgentRoleRegistry,
    parentIdentity?: AgentIdentity,
    graphStore?: AgentGraphStore
  ) {
    this.roleRegistry = roleRegistry || new AgentRoleRegistry();
    this.parentIdentity = parentIdentity || createAgentIdentity(undefined, "groupy-main");
    this.graphStore = graphStore || new AgentGraphStore();
  }

  /**
   * Spawns an independent child agent with a cryptographic identity and specialized role.
   */
  async spawnAgent(params: SpawnAgentParams): Promise<SubAgentSummary> {
    const roleName = params.role || "default";
    const roleConfig = this.roleRegistry.getRole(roleName);
    const agentIndex = this.nextAgentId++;

    const nickname = this.roleRegistry.pickNickname(roleName, agentIndex);
    const agentId = `agent_${agentIndex}_${params.taskName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;

    // Generate cryptographic Ed25519 identity linked to parent agent
    const childIdentity = createAgentIdentity(this.parentIdentity.agentRuntimeId, `groupy-${roleName}`);

    const effectiveModel = params.model || roleConfig?.model || this.parentSession.model;
    const effectiveSystemPrompt =
      params.systemPrompt ||
      (roleConfig
        ? `${roleConfig.systemPrompt}\n\nYour nickname is ${nickname}. Your assigned task is: '${params.taskName}'. Focus strictly on this task.`
        : `You are a specialized sub-agent named ${nickname} tasked with: '${params.taskName}'. Focus strictly on this task.`);

    const baseTools = params.tools || this.parentSession.tools;
    const effectiveTools = this.roleRegistry.filterRouterForRole(baseTools, roleName);

    const childSession = new Session({
      threadId: agentId,
      model: effectiveModel,
      cwd: this.parentSession.cwd,
      systemPrompt: effectiveSystemPrompt,
      modelClient: this.parentSession.modelClient,
      tools: effectiveTools,
    });

    let resolvePromise: (output: string) => void;
    let rejectPromise: (err: Error) => void;

    const taskPromise = new Promise<string>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const handle: SubAgentHandle = {
      id: agentId,
      nickname,
      taskName: params.taskName,
      role: roleName,
      status: "running",
      createdAt: Date.now(),
      identity: childIdentity,
      session: childSession,
      promise: taskPromise,
    };

    // Record directional parent/child topology edge in AgentGraphStore
    try {
      this.graphStore.upsertEdge(this.parentSession.threadId, agentId, "open");
    } catch {}

    // Listen to child session events
    let collectedAgentText = "";
    childSession.onEvent((event) => {
      if (event.msg.type === "AgentMessageDelta") {
        collectedAgentText += event.msg.delta;
      } else if (event.msg.type === "TurnCompleted") {
        handle.status = "completed";
        handle.lastOutput = collectedAgentText.trim();
        try {
          this.graphStore.setEdgeStatus(agentId, "closed");
        } catch {}
        resolvePromise(handle.lastOutput);
      } else if (event.msg.type === "Error") {
        handle.status = "error";
        handle.error = event.msg.message;
        try {
          this.graphStore.setEdgeStatus(agentId, "closed");
        } catch {}
        rejectPromise(new Error(event.msg.message));
      } else if (event.msg.type === "StatusChanged" && event.msg.status === "interrupted") {
        handle.status = "interrupted";
        try {
          this.graphStore.setEdgeStatus(agentId, "closed");
        } catch {}
        resolvePromise(collectedAgentText.trim() || "[Task was interrupted]");
      }
    });

    this.subAgents.set(agentId, handle);

    // Launch task execution
    childSession.prompt(params.message).catch((err) => {
      handle.status = "error";
      handle.error = err instanceof Error ? err.message : String(err);
      try {
        this.graphStore.setEdgeStatus(agentId, "closed");
      } catch {}
      rejectPromise(err);
    });

    return {
      id: handle.id,
      nickname: handle.nickname,
      taskName: handle.taskName,
      role: handle.role,
      status: handle.status,
      createdAt: handle.createdAt,
      agentRuntimeId: childIdentity.agentRuntimeId,
    };
  }

  /**
   * Waits for a sub-agent (or all sub-agents) to finish execution and returns output
   */
  async waitAgent(agentIdOrTaskName?: string, timeoutMs = 60000): Promise<string> {
    if (!agentIdOrTaskName) {
      const handles = Array.from(this.subAgents.values());
      if (handles.length === 0) return "[No active sub-agents]";
      const outputs = await Promise.all(
        handles.map((h) => this.waitSingleAgent(h, timeoutMs))
      );
      return outputs.join("\n\n");
    }

    const handle =
      this.subAgents.get(agentIdOrTaskName) ||
      Array.from(this.subAgents.values()).find(
        (h) => h.taskName.toLowerCase() === agentIdOrTaskName.toLowerCase()
      );

    if (!handle) {
      throw new GroupyError(`Sub-agent '${agentIdOrTaskName}' not found.`);
    }

    return this.waitSingleAgent(handle, timeoutMs);
  }

  private async waitSingleAgent(handle: SubAgentHandle, timeoutMs: number): Promise<string> {
    if (handle.status === "completed" && handle.lastOutput !== undefined) {
      return handle.lastOutput;
    }
    if (handle.status === "error") {
      throw new GroupyError(`Sub-agent '${handle.id}' failed: ${handle.error}`);
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new GroupyError(`Timeout waiting for sub-agent '${handle.id}' after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    return Promise.race([handle.promise, timeoutPromise]);
  }

  async sendInput(agentId: string, message: string, interrupt?: boolean): Promise<string> {
    if (interrupt) {
      const handle = this.subAgents.get(agentId);
      if (handle) handle.session.interrupt();
    }
    return this.sendInputToAgent(agentId, message);
  }

  /**
   * Sends steering guidance or follow-up prompt to a running sub-agent
   */
  async sendInputToAgent(agentId: string, message: string): Promise<string> {
    const handle = this.subAgents.get(agentId);
    if (!handle) {
      throw new GroupyError(`Sub-agent with ID '${agentId}' not found.`);
    }

    const submission = await handle.session.prompt(message);
    return `Message sent to sub-agent ${handle.nickname} (${agentId}) [Turn ID: ${submission.turnId}]`;
  }

  /**
   * Interrupts and terminates a sub-agent
   */
  async closeAgent(agentId: string): Promise<string> {
    const handle = this.subAgents.get(agentId);
    if (!handle) {
      throw new GroupyError(`Sub-agent with ID '${agentId}' not found.`);
    }

    handle.session.interrupt();
    handle.status = "interrupted";
    try {
      this.graphStore.setEdgeStatus(agentId, "closed");
    } catch {}
    return `Sub-agent ${handle.nickname} (${agentId}) interrupted and closed.`;
  }

  /**
   * Returns a list of active and recent sub-agents
   */
  listAgents(): SubAgentSummary[] {
    const list: SubAgentSummary[] = [];
    for (const handle of this.subAgents.values()) {
      list.push({
        id: handle.id,
        nickname: handle.nickname,
        taskName: handle.taskName,
        role: handle.role,
        status: handle.status,
        createdAt: handle.createdAt,
        agentRuntimeId: handle.identity.agentRuntimeId,
        lastOutput: handle.lastOutput,
      });
    }
    return list;
  }

  getAgent(agentId: string): SubAgentHandle | undefined {
    return this.subAgents.get(agentId);
  }
}
