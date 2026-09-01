/**
 * SQLite Thread Store Implementation using native bun:sqlite.
 * Directly mirrors codex-rs/thread-store/src/local/.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Item } from "../protocol/items";
import type { ThreadRecord, ThreadListOptions, RestoredSessionData } from "./types";
import { GroupyError } from "../protocol/errors";
import { getThreadsDbPath } from "../config/paths";

export class SqliteThreadStore {
  private db: Database;

  constructor(dbPath?: string) {
    const effectivePath = dbPath || this.getDefaultDbPath();
    if (effectivePath !== ":memory:") {
      const dir = dirname(effectivePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(effectivePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initSchema();
  }

  private getDefaultDbPath(): string {
    return getThreadsDbPath();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        cwd TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_threads_cwd ON threads(cwd);

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        item_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_items_thread_seq ON items(thread_id, seq ASC);
    `);
  }

  /**
   * Save or insert a new thread record
   */
  saveThread(thread: ThreadRecord): void {
    const query = this.db.prepare(`
      INSERT OR REPLACE INTO threads (id, title, model, cwd, role, status, created_at, updated_at)
      VALUES ($id, $title, $model, $cwd, $role, $status, $createdAt, $updatedAt)
    `);

    query.run({
      $id: thread.id,
      $title: thread.title,
      $model: thread.model,
      $cwd: thread.cwd,
      $role: thread.role,
      $status: thread.status,
      $createdAt: thread.createdAt,
      $updatedAt: thread.updatedAt,
    });
  }

  updateThreadTitle(id: string, title: string): void {
    const query = this.db.prepare(`
      UPDATE threads SET title = $title, updated_at = $updatedAt WHERE id = $id
    `);
    query.run({
      $id: id,
      $title: title,
      $updatedAt: Date.now(),
    });
  }

  updateThreadTimestamp(id: string): void {
    const query = this.db.prepare(`
      UPDATE threads SET updated_at = $updatedAt WHERE id = $id
    `);
    query.run({
      $id: id,
      $updatedAt: Date.now(),
    });
  }

  getThread(id: string): ThreadRecord | null {
    const query = this.db.prepare(`
      SELECT id, title, model, cwd, role, status, created_at as createdAt, updated_at as updatedAt
      FROM threads WHERE id = $id
    `);
    return (query.get({ $id: id }) as ThreadRecord) || null;
  }

  listThreads(options: ThreadListOptions = {}): ThreadRecord[] {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    let sql = `
      SELECT id, title, model, cwd, role, status, created_at as createdAt, updated_at as updatedAt
      FROM threads
    `;
    const params: Record<string, unknown> = { $limit: limit, $offset: offset };
    const conditions: string[] = [];

    if (options.cwd) {
      conditions.push("cwd = $cwd");
      params.$cwd = options.cwd;
    }
    if (options.status) {
      conditions.push("status = $status");
      params.$status = options.status;
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += " ORDER BY updated_at DESC LIMIT $limit OFFSET $offset";

    const query = this.db.prepare(sql);
    return query.all(params as any) as ThreadRecord[];
  }

  /**
   * Append an immutable conversation item to thread history
   */
  appendItem(threadId: string, turnId: string, seq: number, item: Item): void {
    const query = this.db.prepare(`
      INSERT OR REPLACE INTO items (id, thread_id, turn_id, seq, item_type, payload, created_at)
      VALUES ($id, $threadId, $turnId, $seq, $itemType, $payload, $createdAt)
    `);

    query.run({
      $id: item.id,
      $threadId: threadId,
      $turnId: turnId,
      $seq: seq,
      $itemType: item.type,
      $payload: JSON.stringify(item),
      $createdAt: Date.now(),
    });

    this.updateThreadTimestamp(threadId);
  }

  /**
   * Get all items belonging to a thread ordered chronologically
   */
  getItems(threadId: string): Item[] {
    const query = this.db.prepare(`
      SELECT payload FROM items WHERE thread_id = $threadId ORDER BY seq ASC
    `);

    const rows = query.all({ $threadId: threadId }) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as Item);
  }

  /**
   * Loads full thread metadata and reconstructed conversation items
   */
  restoreSession(threadId: string): RestoredSessionData {
    const thread = this.getThread(threadId);
    if (!thread) {
      throw new GroupyError(`Thread with id '${threadId}' not found in thread store.`);
    }

    const items = this.getItems(threadId);
    return { thread, items };
  }

  deleteThread(id: string): boolean {
    const query = this.db.prepare(`DELETE FROM threads WHERE id = $id`);
    const res = query.run({ $id: id });
    return res.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
