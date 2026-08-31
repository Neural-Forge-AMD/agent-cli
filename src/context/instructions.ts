/**
 * System Instructions Builder.
 * Combines modular Markdown templates (base model prompt, modes, permissions, personality, orchestrator),
 * hierarchical AGENTS.md, persistent memories, available skills catalog, and developer guidelines.
 * 
 * Directly mirrors OpenAI Codex prompt assembly architecture.
 */

import { globalPromptLoader } from "../prompts/loader";
import { globalAgentsMdLoader } from "../prompts/agents-md";
import type {
  CollaborationModeKind,
  SandboxModePromptKind,
  ApprovalPolicyPromptKind,
  PersonalityKind,
} from "../prompts/types";

export interface InstructionParams {
  basePrompt?: string;
  basePromptTemplate?: string;
  developerInstructions?: string;
  worldStatePrompt?: string;
  memoriesPrompt?: string;
  skillsPrompt?: string;
  mcpPrompt?: string;
  collaborationMode?: CollaborationModeKind;
  personality?: PersonalityKind;
  isOrchestrator?: boolean;
  cwd?: string;
  networkAccess?: boolean;
  sandboxMode?: SandboxModePromptKind;
  approvalPolicy?: ApprovalPolicyPromptKind;
}

export function buildSystemPrompt(params: InstructionParams): string {
  const sections: string[] = [];
  const cwd = params.cwd || process.cwd();
  const mode = params.collaborationMode || "default";

  // 1. Base identity & model guidelines
  if (params.basePrompt) {
    sections.push(params.basePrompt);
  } else {
    const templateName = params.basePromptTemplate || "base/groupy_prompt.md";
    const baseContent = globalPromptLoader.loadTemplate(templateName, {}, cwd);
    if (baseContent) {
      sections.push(baseContent.trim());
    } else {
      sections.push(
        "You are Groupy, an expert autonomous AI coding assistant. You think step-by-step, act surgically, and write clean, correct code."
      );
    }
  }

  // 2. Personality / Interaction style (if configured)
  if (params.personality) {
    const personalityContent = globalPromptLoader.loadTemplate(
      `personalities/${params.personality}.md`,
      {},
      cwd
    );
    if (personalityContent) {
      sections.push(personalityContent.trim());
    }
  }

  // 3. Multi-Agent Orchestrator guidelines (if running as root orchestrator)
  if (params.isOrchestrator) {
    const orchestratorContent = globalPromptLoader.loadTemplate(
      "agents/orchestrator.md",
      {},
      cwd
    );
    if (orchestratorContent) {
      sections.push(orchestratorContent.trim());
    }
  }

  // 4. Active Collaboration Mode Template (modes/default.md, modes/plan.md, modes/review.md)
  const modeTemplate = globalPromptLoader.loadTemplate(
    `modes/${mode}.md`,
    {
      KNOWN_MODE_NAMES: "default, plan, review",
    },
    cwd
  );
  if (modeTemplate) {
    sections.push(modeTemplate.trim());
  }

  // 5. Permissions & Sandboxing Template (if configured)
  if (params.sandboxMode) {
    const sandboxTemplate = globalPromptLoader.loadTemplate(
      `permissions/sandbox_mode/${params.sandboxMode}.md`,
      {
        network_access: params.networkAccess ? "enabled" : "disabled",
      },
      cwd
    );
    if (sandboxTemplate) {
      sections.push(sandboxTemplate.trim());
    }
  }

  if (params.approvalPolicy) {
    const approvalTemplate = globalPromptLoader.loadTemplate(
      `permissions/approval_policy/${params.approvalPolicy}.md`,
      {},
      cwd
    );
    if (approvalTemplate) {
      sections.push(approvalTemplate.trim());
    }
  }

  // 6. Hierarchical AGENTS.md instructions (from .git root to cwd)
  const projectInstructions = globalAgentsMdLoader.loadProjectInstructions(cwd);
  if (projectInstructions) {
    sections.push(`## Project Instructions (AGENTS.md)\n\n${projectInstructions.content.trim()}`);
  }

  // 7. Persistent User Memories & Preferences (if any)
  if (params.memoriesPrompt) {
    sections.push(params.memoriesPrompt.trim());
  }

  // 8. Available Domain Skills (if any)
  if (params.skillsPrompt) {
    sections.push(params.skillsPrompt.trim());
  }

  // 9. Model Context Protocol (MCP) Servers catalog (Lazy & Eager)
  if (params.mcpPrompt) {
    sections.push(params.mcpPrompt.trim());
  }

  // 10. Developer specific instructions
  if (params.developerInstructions) {
    sections.push(`## Developer Instructions\n${params.developerInstructions}`);
  }

  // 10. World state / environment snapshot
  if (params.worldStatePrompt) {
    sections.push(`## Environment Context\n${params.worldStatePrompt}`);
  }

  return sections.join("\n\n");
}
