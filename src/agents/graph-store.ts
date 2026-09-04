/**
 * AgentGraphStore - Persisted topology store for multi-agent parent/child relationships.
 * Directly mirrors codex-rs/agent-graph-store.
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { getAgentGraphDbPath } from "../config/paths";

export type ThreadSpawnEdgeStatus = "open" | "closed";

export interface ThreadSpawnEdge {
  childThreadId: string;
  parentThreadId: string;
  status: ThreadSpawnEdgeStatus;
  createdAt: number;
  updatedAt: number;
}

export class AgentGraphStore {
  private db: Database;

  constructor(dbPathOrDb?: string | Database) {
    if (dbPathOrDb instanceof Database) {
      this.db = dbPathOrDb;
    } else {
      const dbPath = dbPathOrDb || getAgentGraphDbPath();

      if (dbPath !== ":memory:") {
        const dir = resolve(dbPath, "..");
        if (!existsSync(dir)) {
          try {
            mkdirSync(dir, { recursive: true });
          } catch (err) {
            console.warn(`[AgentGraphStore] Failed to create database directory '${dir}':`, err);
          }
        }
      }

      this.db = new Database(dbPath);
    }

    this.initSchema();
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS thread_spawn_edges (
        child_thread_id TEXT PRIMARY KEY,
        parent_thread_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_thread_spawn_edges_parent ON thread_spawn_edges(parent_thread_id);
    `);
  }

  /**
   * Insert or replace directional parent/child edge for a spawned thread.
   */
  upsertEdge(
    parentThreadId: string,
    childThreadId: string,
    status: ThreadSpawnEdgeStatus = "open"
  ): void {
    const now = Date.now();
    const query = this.db.prepare(`
      INSERT INTO thread_spawn_edges (child_thread_id, parent_thread_id, status, created_at, updated_at)
      VALUES ($child, $parent, $status, $createdAt, $updatedAt)
      ON CONFLICT(child_thread_id) DO UPDATE SET
        parent_thread_id = excluded.parent_thread_id,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    query.run({
      $child: childThreadId,
      $parent: parentThreadId,
      $status: status,
      $createdAt: now,
      $updatedAt: now,
    });
  }

  /**
   * Updates lifecycle status of a spawned thread edge.
   */
  setEdgeStatus(childThreadId: string, status: ThreadSpawnEdgeStatus): void {
    const query = this.db.prepare(`
      UPDATE thread_spawn_edges
      SET status = $status, updated_at = $updatedAt
      WHERE child_thread_id = $child
    `);

    query.run({
      $child: childThreadId,
      $status: status,
      $updatedAt: Date.now(),
    });
  }

  /**
   * List direct spawned children of a parent thread.
   */
  listChildren(
    parentThreadId: string,
    statusFilter?: ThreadSpawnEdgeStatus
  ): string[] {
    let sql = `SELECT child_thread_id FROM thread_spawn_edges WHERE parent_thread_id = $parent`;
    const params: Record<string, string> = { $parent: parentThreadId };

    if (statusFilter) {
      sql += ` AND status = $status`;
      params.$status = statusFilter;
    }

    sql += ` ORDER BY created_at ASC`;

    const rows = this.db.prepare(sql).all(params) as Array<{ child_thread_id: string }>;
    return rows.map((r) => r.child_thread_id);
  }

  /**
   * List spawned descendants breadth-first by depth, then by thread id.
   */
  listDescendants(
    rootThreadId: string,
    statusFilter?: ThreadSpawnEdgeStatus
  ): string[] {
    const results: string[] = [];
    const queue: string[] = [rootThreadId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const children = this.listChildren(current, statusFilter);
      for (const child of children) {
        if (!visited.has(child)) {
          results.push(child);
          queue.push(child);
        }
      }
    }

    return results;
  }

  close(): void {
    try {
      this.db.close();
    } catch (err) {
      console.warn("[AgentGraphStore] Failed to close database cleanly:", err);
    }
  }
}
