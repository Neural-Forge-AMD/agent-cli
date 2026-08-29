/**
 * ToolRouter manages tool registration, schema translation for LLM prompts,
 * and dispatching tool executions.
 */

import type { Tool, ToolContext, ToolExecutionResult } from "./types";

export class ToolRouter {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  toModelToolsSchema(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Tool["parameters"];
    };
  }> {
    return this.list().map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  toOpenAISpec(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Tool["parameters"];
    };
  }> {
    return this.toModelToolsSchema();
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        output: `Error: Tool '${name}' not found. Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
        isError: true,
      };
    }

    try {
      return await tool.execute(args, ctx);
    } catch (error) {
      return {
        output: `Error executing tool '${name}': ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }
}
