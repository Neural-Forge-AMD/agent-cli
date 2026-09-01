/**
 * Memories Subsystem Types & Schemas.
 * Aligned with Anthropic Claude Code Auto-Memory specifications.
 */

export type MemoryCategory =
  | "user"
  | "feedback"
  | "project"
  | "reference"
  // Legacy aliases
  | "preference"
  | "guideline"
  | "architecture"
  | "note";

export interface TopicMemoryFile {
  type: "user" | "feedback" | "project" | "reference";
  name: string;
  description?: string;
  modified: string; // ISO 8601 timestamp
  content: string;
  filePath?: string;
}

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  name?: string;
  description?: string;
  content: string;
  scope: "global" | "workspace" | "project";
  createdAt: number;
  modifiedAt?: number;
  filePath?: string;
}

export interface AutoMemoryIndexItem {
  type: string;
  name: string;
  summary: string;
  topicFile?: string;
}
