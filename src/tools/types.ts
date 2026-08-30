/**
 * Tool definitions and execution contract for Groupy.
 */

export interface ToolParameterProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  enum?: string[];
  items?: ToolParameterProperty;
}

export interface ToolParametersSchema {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

import type { ExecPolicy } from "../security/exec-policy";

export interface ToolContext {
  cwd: string;
  turnId: string;
  signal?: AbortSignal;
  execPolicy?: ExecPolicy;
  requestApproval?: (description: string, command?: string) => Promise<boolean>;
  requestInput?: (question: string, options?: string[]) => Promise<string>;
}

export type ToolExecutionContext = ToolContext;

export interface ToolExecutionResult {
  output: string;
  isError?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionResult>;
}
