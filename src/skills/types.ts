/**
 * Skills Subsystem Types & Schemas.
 * Directly mirrors codex-rs/skills/src/model.rs.
 */

export type SkillScope = "workspace" | "global";

export interface SkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  path: string;
  rootDir: string;
  scope: SkillScope;
}

export interface LoadedSkill extends SkillMetadata {
  instructions: string;
}
