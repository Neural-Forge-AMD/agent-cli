/**
 * Prompt Template & AGENTS.md Types.
 * Directly mirrors codex-rs/prompts, codex-rs/core/src/agents_md.rs, and codex-rs/core/templates.
 */

export type CollaborationModeKind = "default" | "plan" | "review";

export type SandboxModePromptKind = "workspace_write" | "read_only" | "danger_full_access";

export type ApprovalPolicyPromptKind = "on_request" | "never";

export type PersonalityKind = "pragmatic" | "friendly";

export interface TemplateVariables {
  [key: string]: string | number | boolean | undefined;
}

export interface LoadedAgentsMd {
  content: string;
  sourcePaths: string[];
}
