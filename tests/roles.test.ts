import { describe, it, expect } from "bun:test";
import { AgentRoleRegistry } from "../src/agents/roles";
import { ToolRouter } from "../src/tools/router";
import type { Tool, ToolContext, ToolExecutionResult } from "../src/tools/types";

function makeTool(name: string): Tool {
  return {
    name,
    description: `Mock tool ${name}`,
    parameters: { type: "object", properties: {}, required: [] },
    async execute(_args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolExecutionResult> {
      return { output: name };
    },
  };
}

function makeRouter(names: string[]): ToolRouter {
  const r = new ToolRouter();
  for (const n of names) r.register(makeTool(n));
  return r;
}

describe("Agent Role Tool Filtering (MCP Least-Privilege)", () => {
  const registry = new AgentRoleRegistry();

  const fullRouter = makeRouter([
    "read_file", "write_file", "shell", "list_dir",
    "mcp__github__list_issues", "mcp__github__create_issue", "mcp__github__create_pr",
    "mcp__postgres__query", "mcp__postgres__execute",
    "mcp__slack__post_message",
    "spawn_agent", "remember",
  ]);

  it("planner role cannot access ANY mcp__ tool", () => {
    const filtered = registry.filterRouterForRole(fullRouter, "planner");
    const names = filtered.list().map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names.some((n) => n.startsWith("mcp__"))).toBe(false);
  });

  it("reviewer role cannot access ANY mcp__ tool", () => {
    const filtered = registry.filterRouterForRole(fullRouter, "reviewer");
    const names = filtered.list().map((t) => t.name);
    expect(names.some((n) => n.startsWith("mcp__"))).toBe(false);
  });

  it("exact MCP tool name grants access to that tool only", () => {
    registry.registerRole({
      name: "github-only",
      description: "GitHub issue creator",
      systemPrompt: "GitHub issue creator",
      allowedToolNames: ["read_file", "mcp__github__create_issue"],
    });
    const filtered = registry.filterRouterForRole(fullRouter, "github-only");
    const names = filtered.list().map((t) => t.name);
    expect(names).toContain("mcp__github__create_issue");
    expect(names).not.toContain("mcp__github__list_issues");
    expect(names).not.toContain("mcp__postgres__query");
    expect(names).not.toContain("mcp__slack__post_message");
  });

  it("server-scoped wildcard mcp__github__* grants all github tools but not other servers", () => {
    registry.registerRole({
      name: "github-full",
      description: "Full GitHub access",
      systemPrompt: "GitHub agent",
      allowedToolNames: ["shell", "mcp__github__*"],
    });
    const filtered = registry.filterRouterForRole(fullRouter, "github-full");
    const names = filtered.list().map((t) => t.name);
    expect(names).toContain("mcp__github__list_issues");
    expect(names).toContain("mcp__github__create_issue");
    expect(names).toContain("mcp__github__create_pr");
    expect(names).not.toContain("mcp__postgres__query");
    expect(names).not.toContain("mcp__slack__post_message");
  });

  it("default role cannot access any mcp__ tool (not in explicit allowedToolNames)", () => {
    const filtered = registry.filterRouterForRole(fullRouter, "default");
    const names = filtered.list().map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("spawn_agent");
    expect(names.some((n) => n.startsWith("mcp__"))).toBe(false);
  });

  it("role with no allowedToolNames returns full router unchanged", () => {
    registry.registerRole({
      name: "unrestricted-test",
      description: "No restrictions",
      systemPrompt: "Unrestricted",
    });
    const filtered = registry.filterRouterForRole(fullRouter, "unrestricted-test");
    expect(filtered.list().length).toBe(fullRouter.list().length);
  });
});
