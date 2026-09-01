/**
 * Tool definitions and execution contract for Groupy.
 */

import type { ExecPolicy, PermissionMode } from "../security/exec-policy";
import type { PlanItem } from "../protocol/events";
import type { PrefixRulesStore } from "../storage/prefix-rules-store";

export interface ToolParameterProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  enum?: string[];
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolParametersSchema {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolContext {
  cwd: string;
  turnId: string;
  signal?: AbortSignal;
  execPolicy?: ExecPolicy;
  mode?: string;
  permissionMode?: PermissionMode;
  prefixRulesStore?: PrefixRulesStore;
  onPlanUpdate?: (plan: PlanItem[], explanation?: string) => void;
  requestApproval?: (description: string, command?: string, prefixRule?: string[]) => Promise<{ allowed: boolean; rememberPrefix?: boolean } | boolean>;
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
