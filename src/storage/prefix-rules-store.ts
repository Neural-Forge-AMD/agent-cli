/**
 * Persistent SQLite Store for Approved Command Prefix Rules.
 * Directly mirrors codex-rs/core/src/config/ rules and approval persistence.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

export interface ApprovedPrefixRuleRecord {
  id: string;
  workspacePath: string;
  prefixTokens: string[];
  createdAt: number;
}

export class PrefixRulesStore {
  private db: Database;

  constructor(dbOrPath?: Database | string) {
    if (dbOrPath instanceof Database) {
      this.db = dbOrPath;
    } else {
      const effectivePath = dbOrPath || resolve(homedir(), ".groupy", "groupy_rules.db");
      if (effectivePath !== ":memory:") {
        const dir = dirname(effectivePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new Database(effectivePath);
      this.db.exec("PRAGMA journal_mode = WAL;");
    }

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approved_prefix_rules (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        prefix_tokens TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_prefix_rules_ws ON approved_prefix_rules(workspace_path);
    `);
  }

  /**
   * Adds an approved prefix rule for a workspace or globally (if workspacePath is "*").
   */
  addRule(workspacePath: string, prefixTokens: string[]): void {
    if (!prefixTokens || prefixTokens.length === 0) return;

    const normalizedWs = workspacePath === "*" ? "*" : resolve(workspacePath);
    const tokensJson = JSON.stringify(prefixTokens);
    const id = `${normalizedWs}:${tokensJson}`;

    const query = this.db.prepare(`
      INSERT OR REPLACE INTO approved_prefix_rules (id, workspace_path, prefix_tokens, created_at)
      VALUES ($id, $workspacePath, $prefixTokens, $createdAt)
    `);

    query.run({
      $id: id,
      $workspacePath: normalizedWs,
      $prefixTokens: tokensJson,
      $createdAt: Date.now(),
    });
  }

  /**
   * Checks if a command's token array matches any approved prefix rule.
   */
  isApproved(workspacePath: string, commandTokens: string[]): boolean {
    if (!commandTokens || commandTokens.length === 0) return false;

    const normalizedWs = resolve(workspacePath);

    const query = this.db.prepare(`
      SELECT prefix_tokens FROM approved_prefix_rules
      WHERE workspace_path = $ws OR workspace_path = '*'
    `);

    const rows = query.all({ $ws: normalizedWs }) as { prefix_tokens: string }[];

    for (const row of rows) {
      try {
        const prefix = JSON.parse(row.prefix_tokens) as string[];
        if (this.matchesPrefix(commandTokens, prefix)) {
          return true;
        }
      } catch {}
    }

    return false;
  }

  /**
   * Lists all approved prefix rules for a workspace.
   */
  listRules(workspacePath?: string): string[][] {
    let rows: { prefix_tokens: string }[];

    if (workspacePath) {
      const normalizedWs = workspacePath === "*" ? "*" : resolve(workspacePath);
      const query = this.db.prepare(`
        SELECT prefix_tokens FROM approved_prefix_rules
        WHERE workspace_path = $ws OR workspace_path = '*'
      `);
      rows = query.all({ $ws: normalizedWs }) as { prefix_tokens: string }[];
    } else {
      const query = this.db.prepare(`SELECT prefix_tokens FROM approved_prefix_rules`);
      rows = query.all() as { prefix_tokens: string }[];
    }

    return rows.map((r) => {
      try {
        return JSON.parse(r.prefix_tokens);
      } catch {
        return [];
      }
    }).filter((r) => r.length > 0);
  }

  /**
   * Removes an approved rule.
   */
  removeRule(workspacePath: string, prefixTokens: string[]): void {
    const normalizedWs = workspacePath === "*" ? "*" : resolve(workspacePath);
    const tokensJson = JSON.stringify(prefixTokens);
    const id = `${normalizedWs}:${tokensJson}`;

    const query = this.db.prepare(`
      DELETE FROM approved_prefix_rules WHERE id = $id
    `);
    query.run({ $id: id });
  }

  /**
   * Helper to check if command starts with prefix tokens.
   */
  private matchesPrefix(cmdTokens: string[], prefixTokens: string[]): boolean {
    if (prefixTokens.length > cmdTokens.length) return false;
    for (let i = 0; i < prefixTokens.length; i++) {
      const cmd = cmdTokens[i];
      const prefix = prefixTokens[i];
      if (!cmd || !prefix || cmd.toLowerCase() !== prefix.toLowerCase()) {
        return false;
      }
    }
    return true;
  }

  close(): void {
    this.db.close();
  }
}

export const globalPrefixRulesStore = new PrefixRulesStore();
