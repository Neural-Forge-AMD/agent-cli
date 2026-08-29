/**
 * Thread Store & Session Persistence Types.
 * Directly mirrors codex-rs/thread-store/src/types.rs and local/mod.rs.
 */

import type { Item } from "../protocol/items";

export type ThreadStatus = "active" | "completed" | "archived";

export interface ThreadRecord {
  id: string;
  title: string;
  model: string;
  cwd: string;
  role: string;
  status: ThreadStatus;
  itemsCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ItemRecord {
  id: string;
  threadId: string;
  turnId: string;
  seq: number;
  itemType: string;
  payload: string; // JSON serialized Item
  createdAt: number;
}

export interface RestoredSessionData {
  thread: ThreadRecord;
  items: Item[];
}

export interface ThreadListOptions {
  limit?: number;
  offset?: number;
  cwd?: string;
  status?: ThreadStatus;
}
