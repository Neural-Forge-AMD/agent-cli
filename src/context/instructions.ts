/**
 * Structured & Modular System Instructions Builder.
 * Combines modular templates (base model prompt, modes, permissions, personality, orchestrator),
 * hierarchical AGENTS.md, persistent memories, available skills catalog, and developer guidelines
 * into clean semantic XML blocks with explicit Prompt Caching boundaries.
 * 
 * Directly mirrors OpenAI Codex & Claude-Code prompt assembly architecture.
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

export interface StructuredPromptBlock {
  tag: string;
  content: string;
  cacheable: boolean;
}

export interface StructuredSystemPromptResult {
  /** Complete prompt string formatted with XML semantic tags */
  text: string;
  /** Static prefix (identity, modes, AGENTS.md, skills, mcp, memories) - guaranteed stable for caching */
  staticPrefix: string;
  /** Dynamic turn suffix (world state, ephemeral runtime context) */
  dynamicSuffix: string;
  /** Structured blocks with cacheable metadata */
  blocks: StructuredPromptBlock[];
}

function wrapXmlTag(tag: string, content: string, attrs: Record<string, string> = {}): string {
  const attrStr = Object.entries(attrs)
    .filter(([_, v]) => Boolean(v))
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  return `<${tag}${attrStr}>\n${content.trim()}\n</${tag}>`;
}

/**
 * Builds structured XML system prompt blocks with clean separation between
 * static cacheable prefix and dynamic per-turn context.
 */
export function buildStructuredSystemPrompt(params: InstructionParams): StructuredSystemPromptResult {
  const cwd = params.cwd || process.cwd();
  const mode = params.collaborationMode || "default";
  const blocks: StructuredPromptBlock[] = [];

  // 1. Base Identity & Model Guidelines (Static / Cacheable)
  let baseContent = params.basePrompt;
  if (!baseContent) {
    const templateName = params.basePromptTemplate || "base/groupy_prompt.md";
    baseContent = globalPromptLoader.loadTemplate(templateName, {}, cwd) || 
      "You are Groupy, an expert autonomous AI coding assistant. You think step-by-step, act surgically, and write clean, correct code.";
  }
  blocks.push({
    tag: "system_identity",
    content: wrapXmlTag("system_identity", baseContent),
    cacheable: true,
  });

  // 2. Personality / Interaction style (Static / Cacheable)
  if (params.personality) {
    const personalityContent = globalPromptLoader.loadTemplate(
      `personalities/${params.personality}.md`,
      {},
      cwd
    );
    if (personalityContent) {
      blocks.push({
        tag: "personality",
        content: wrapXmlTag("personality", personalityContent, { kind: params.personality }),
        cacheable: true,
      });
    }
  }

  // 3. Multi-Agent Orchestrator guidelines (Static / Cacheable)
  if (params.isOrchestrator) {
    const orchestratorContent = globalPromptLoader.loadTemplate(
      "agents/orchestrator.md",
      {},
      cwd
    );
    if (orchestratorContent) {
      blocks.push({
        tag: "orchestrator_guidelines",
        content: wrapXmlTag("orchestrator_guidelines", orchestratorContent),
        cacheable: true,
      });
    }
  }

  // 4. Active Collaboration Mode (Static / Cacheable)
  const modeTemplate = globalPromptLoader.loadTemplate(
    `modes/${mode}.md`,
    { KNOWN_MODE_NAMES: "default, plan, review" },
    cwd
  );
  if (modeTemplate) {
    blocks.push({
      tag: "collaboration_mode",
      content: wrapXmlTag("collaboration_mode", modeTemplate, { name: mode }),
      cacheable: true,
    });
  }

  // 5. Permissions & Sandboxing Template (Static / Cacheable)
  if (params.sandboxMode) {
    const sandboxTemplate = globalPromptLoader.loadTemplate(
      `permissions/sandbox_mode/${params.sandboxMode}.md`,
      { network_access: params.networkAccess ? "enabled" : "disabled" },
      cwd
    );
    if (sandboxTemplate) {
      blocks.push({
        tag: "sandbox_policy",
        content: wrapXmlTag("sandbox_policy", sandboxTemplate, { mode: params.sandboxMode }),
        cacheable: true,
      });
    }
  }

  if (params.approvalPolicy) {
    const approvalTemplate = globalPromptLoader.loadTemplate(
      `permissions/approval_policy/${params.approvalPolicy}.md`,
      {},
      cwd
    );
    if (approvalTemplate) {
      blocks.push({
        tag: "approval_policy",
        content: wrapXmlTag("approval_policy", approvalTemplate, { policy: params.approvalPolicy }),
        cacheable: true,
      });
    }
  }

  // 6. Hierarchical AGENTS.md Project Instructions (Static / Cacheable)
  const projectInstructions = globalAgentsMdLoader.loadProjectInstructions(cwd);
  if (projectInstructions) {
    blocks.push({
      tag: "project_instructions",
      content: wrapXmlTag("project_instructions", projectInstructions.content, { source: "AGENTS.md" }),
      cacheable: true,
    });
  }

  // 7. Persistent User Memories & Preferences (Static / Cacheable)
  if (params.memoriesPrompt) {
    blocks.push({
      tag: "persistent_memories",
      content: wrapXmlTag("persistent_memories", params.memoriesPrompt),
      cacheable: true,
    });
  }

  // 8. Available Domain Skills Catalog (Static / Cacheable)
  if (params.skillsPrompt) {
    blocks.push({
      tag: "domain_skills",
      content: wrapXmlTag("domain_skills", params.skillsPrompt),
      cacheable: true,
    });
  }

  // 9. Model Context Protocol (MCP) Servers Catalog (Static / Cacheable)
  if (params.mcpPrompt) {
    blocks.push({
      tag: "mcp_servers",
      content: wrapXmlTag("mcp_servers", params.mcpPrompt),
      cacheable: true,
    });
  }

  // 10. Developer specific instructions (Static / Cacheable)
  if (params.developerInstructions) {
    blocks.push({
      tag: "developer_instructions",
      content: wrapXmlTag("developer_instructions", params.developerInstructions),
      cacheable: true,
    });
  }

  // 11. Dynamic Runtime Environment Context (Dynamic / Volatile)
  const dynamicBlocks: StructuredPromptBlock[] = [];
  if (params.worldStatePrompt) {
    dynamicBlocks.push({
      tag: "runtime_environment",
      content: wrapXmlTag("runtime_environment", params.worldStatePrompt),
      cacheable: false,
    });
  }

  const staticPrefix = blocks.map((b) => b.content).join("\n\n");
  const dynamicSuffix = dynamicBlocks.map((b) => b.content).join("\n\n");
  const allBlocks = [...blocks, ...dynamicBlocks];
  const text = allBlocks.map((b) => b.content).join("\n\n");

  return {
    text,
    staticPrefix,
    dynamicSuffix,
    blocks: allBlocks,
  };
}

/**
 * Standard entry point returning the complete XML-tagged system prompt string.
 */
export function buildSystemPrompt(params: InstructionParams): string {
  return buildStructuredSystemPrompt(params).text;
}
