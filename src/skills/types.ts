/**
 * Skills Subsystem Types & Schemas.
 * Directly mirrors codex-rs/skills/src/model.rs.
 */

export type SkillScope = "workspace" | "global" | "built-in";

export interface SkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  path: string;
  rootDir: string;
  scope: SkillScope;
  enabled?: boolean;
}

export interface LoadedSkill extends SkillMetadata {
  instructions: string;
}
