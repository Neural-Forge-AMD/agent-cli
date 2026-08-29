/**
 * Memories Subsystem Types & Schemas.
 * Directly mirrors codex-rs/memories.
 */

export type MemoryCategory = "preference" | "guideline" | "architecture" | "note";

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;
  scope: "global" | "workspace";
  createdAt: number;
}
