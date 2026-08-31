/**
 * Agent Roles & Specialized Personas.
 * Directly mirrors codex-rs/agent-roles and codex-rs/core/src/agent/role.rs.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { ToolRouter } from "../tools/router";

export interface AgentRole {
  name: string;
  description: string;
  systemPrompt: string;
  nicknameCandidates?: string[];
  model?: string;
  allowedToolNames?: string[];
}

export class AgentRoleRegistry {
  private roles = new Map<string, AgentRole>();

  constructor() {
    this.initDefaultRoles();
  }

  private initDefaultRoles(): void {
    // 1. Generalist Developer Agent
    this.registerRole({
      name: "default",
      description: "Generalist autonomous developer agent capable of coding, testing, and debugging.",
      systemPrompt:
        "You are Groupy, an expert autonomous software engineer. Think carefully, use tools surgically, and verify every step.",
      nicknameCandidates: ["Pikaa", "Heca", "Bankli", "Moli"],
    });

    // 2. Code Reviewer
    this.registerRole({
      name: "reviewer",
      description: "Specialized code review agent focusing on architecture, security, performance, and edge cases.",
      systemPrompt:
        "You are a Senior Code Reviewer. Carefully inspect diffs and code structure for bugs, security vulnerabilities, and style adherence. Be precise and provide actionable feedback.",
      nicknameCandidates: ["Sentinel", "Inspector", "Audit", "Guardian"],
      allowedToolNames: ["read_file", "list_dir", "shell"],
    });

    // 3. Researcher / Explorer
    this.registerRole({
      name: "researcher",
      description: "Deep research and codebase exploration agent for mapping dependencies and finding implementations.",
      systemPrompt:
        "You are a Research Specialist. Thoroughly investigate the codebase, discover relevant files and patterns, and synthesize clear architectural summaries.",
      nicknameCandidates: ["Scout", "Navigator", "Compass", "Finder"],
      allowedToolNames: ["read_file", "list_dir", "shell", "read_mcp_resource"],
    });

    // 4. Test Engineer / QA
    this.registerRole({
      name: "tester",
      description: "Quality assurance and automated testing agent dedicated to writing and executing test suites.",
      systemPrompt:
        "You are a QA and Test Automation Engineer. Execute test suites, diagnose failures, write regression tests, and ensure 100% verification.",
      nicknameCandidates: ["Verifier", "Validator", "Checkmate", "Tester"],
      allowedToolNames: ["read_file", "apply_patch", "write_file", "shell"],
    });

    // 5. Software Architect / Planner
    this.registerRole({
      name: "planner",
      description: "High-level architecture and task breakdown agent focusing on planning multi-step implementations.",
      systemPrompt:
        "You are a Principal Software Architect. Formulate clear, phased, modular implementation plans and component breakdown.",
      nicknameCandidates: ["Blueprint", "Architect", "Strategist"],
      allowedToolNames: ["read_file", "list_dir"],
    });

    // 6. Security Auditor / Penetration Tester (Strix)
    this.registerRole({
      name: "security-auditor",
      description: "Autonomous security auditing & penetration testing agent for vulnerability discovery, threat modeling, and defensive remediation.",
      systemPrompt:
        "You are an Elite Security Auditor and Penetration Testing Specialist (inspired by Strix). Your mission is to defensively map attack surfaces, discover security vulnerabilities (OWASP Top 10, secrets leakage, auth bypass, input boundary flaws), and produce safe, verified remediation patches.",
      nicknameCandidates: ["Aegis", "Strix", "Warden", "Sentinel", "Guardian"],
      allowedToolNames: ["read_file", "list_dir", "shell", "apply_patch", "write_file"],
    });
  }

  registerRole(role: AgentRole): void {
    this.roles.set(role.name.toLowerCase(), role);
  }

  getRole(name: string): AgentRole | undefined {
    return this.roles.get(name.toLowerCase());
  }

  hasRole(name: string): boolean {
    return this.roles.has(name.toLowerCase());
  }

  listRoles(): AgentRole[] {
    return Array.from(this.roles.values());
  }

  /**
   * Automatically picks a friendly nickname for a spawned role
   */
  pickNickname(roleName: string, index = 1): string {
    const role = this.getRole(roleName);
    const candidates = role?.nicknameCandidates || ["Agent"];
    const base = candidates[(index - 1) % candidates.length] || "Agent";
    const cycle = Math.floor((index - 1) / candidates.length);
    return cycle === 0 ? base : `${base}_${cycle + 1}`;
  }

  /**
   * Load custom agent role definitions from a directory (e.g. .agents/roles/)
   */
  loadRolesFromDir(dirPath: string): void {
    const fullPath = resolve(dirPath);
    if (!existsSync(fullPath)) return;

    const entries = readdirSync(fullPath);
    for (const entry of entries) {
      if (entry.endsWith(".json")) {
        try {
          const content = readFileSync(join(fullPath, entry), "utf8");
          const parsed: AgentRole = JSON.parse(content);
          if (parsed.name && parsed.systemPrompt) {
            this.registerRole(parsed);
          }
        } catch (err) {
          console.error(`Failed to parse agent role file '${entry}':`, err);
        }
      }
    }
  }

  /**
   * Filters a ToolRouter based on role allowedToolNames (if specified)
   */
  filterRouterForRole(sourceRouter: ToolRouter, roleName?: string): ToolRouter {
    if (!roleName) return sourceRouter;
    const role = this.getRole(roleName);
    if (!role || !role.allowedToolNames) return sourceRouter;

    const filtered = sourceRouter.list().filter((t) => {
      return role.allowedToolNames!.some((allowed) => t.name === allowed || t.name.startsWith(`mcp__`));
    });

    const newRouter = new (sourceRouter.constructor as typeof ToolRouter)();
    for (const tool of filtered) {
      newRouter.register(tool);
    }
    return newRouter;
  }
}
