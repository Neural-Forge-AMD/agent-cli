/**
 * Native SQLite Database Engine utilizing bun:sqlite.
 * Features: Zero dependencies, fast C-bindings, safe read-only query guard, PRAGMA inspectors.
 */

import { Database } from "bun:sqlite";
import { resolve, isAbsolute } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type {
  SqliteTableSummary,
  SqliteTableDetail,
  SqliteQueryResult,
  SqliteWriteResult,
  SqliteQueryPlanNode,
  SqliteColumnInfo,
  SqliteForeignKeyInfo,
  SqliteIndexInfo,
} from "./types";

export class SqliteEngine {
  private connections = new Map<string, Database>();
  private defaultDbPath: string | null = null;

  constructor(defaultPath?: string) {
    if (defaultPath) {
      this.defaultDbPath = this.resolvePath(defaultPath);
    }
  }

  /**
   * Sets default DB path or auto-discovers if none specified.
   */
  setDefaultDbPath(dbPath: string): void {
    this.defaultDbPath = this.resolvePath(dbPath);
  }

  private resolvePath(dbPath?: string): string {
    if (!dbPath) {
      if (this.defaultDbPath) return this.defaultDbPath;

      // Auto-discover SQLite database in cwd
      const discovered = this.autoDiscoverDatabase();
      if (discovered) {
        this.defaultDbPath = discovered;
        return discovered;
      }

      // Default fallback
      const fallback = resolve(process.cwd(), "dev.sqlite");
      this.defaultDbPath = fallback;
      return fallback;
    }

    return isAbsolute(dbPath) ? dbPath : resolve(process.cwd(), dbPath);
  }

  private autoDiscoverDatabase(): string | null {
    try {
      const files = readdirSync(process.cwd());
      const dbFile = files.find((f) => f.endsWith(".sqlite") || f.endsWith(".sqlite3") || f.endsWith(".db"));
      return dbFile ? resolve(process.cwd(), dbFile) : null;
    } catch {
      return null;
    }
  }

  private getDb(dbPath?: string): Database {
    const fullPath = this.resolvePath(dbPath);
    let db = this.connections.get(fullPath);
    if (!db) {
      db = new Database(fullPath, { create: true });
      // Enable WAL mode for high concurrency
      db.run("PRAGMA journal_mode = WAL;");
      db.run("PRAGMA foreign_keys = ON;");
      this.connections.set(fullPath, db);
    }
    return db;
  }

  /**
   * Lists all user tables and views in the database.
   */
  listTables(dbPath?: string): SqliteTableSummary[] {
    const db = this.getDb(dbPath);
    const query = `
      SELECT name, type, sql
      FROM sqlite_master
      WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC;
    `;

    const tables = db.query(query).all() as Array<{ name: string; type: "table" | "view"; sql: string }>;

    return tables.map((t) => {
      let rowCount = 0;
      let columnCount = 0;
      try {
        if (t.type === "table") {
          const countRes = db.query(`SELECT COUNT(*) as count FROM "${t.name}"`).get() as { count: number } | null;
          rowCount = countRes?.count || 0;
        }
        const cols = db.query(`PRAGMA table_info("${t.name}")`).all();
        columnCount = cols.length;
      } catch {}

      return {
        name: t.name,
        type: t.type,
        rowCount,
        columnCount,
        sql: t.sql,
      };
    });
  }

  /**
   * Describes a table schema: columns, data types, primary keys, foreign keys, and indexes.
   */
  describeTable(tableName: string, dbPath?: string): SqliteTableDetail {
    const db = this.getDb(dbPath);

    // Verify table exists
    const meta = db
      .query(`SELECT type, sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')`)
      .get(tableName) as { type: "table" | "view"; sql: string } | null;

    if (!meta) {
      throw new Error(`Table or view '${tableName}' does not exist in database.`);
    }

    // 1. Column info
    const rawCols = db.query(`PRAGMA table_info("${tableName}")`).all() as any[];
    const columns: SqliteColumnInfo[] = rawCols.map((c) => ({
      cid: c.cid,
      name: c.name,
      type: c.type || "BLOB",
      notnull: Boolean(c.notnull),
      dflt_value: c.dflt_value,
      pk: Boolean(c.pk),
    }));

    // 2. Foreign keys
    const rawFks = db.query(`PRAGMA foreign_key_list("${tableName}")`).all() as any[];
    const foreignKeys: SqliteForeignKeyInfo[] = rawFks.map((fk) => ({
      id: fk.id,
      seq: fk.seq,
      table: fk.table,
      from: fk.from,
      to: fk.to,
      on_update: fk.on_update,
      on_delete: fk.on_delete,
      match: fk.match,
    }));

    // 3. Indexes
    const rawIdxs = db.query(`PRAGMA index_list("${tableName}")`).all() as any[];
    const indexes: SqliteIndexInfo[] = rawIdxs.map((idx) => {
      const idxCols = db.query(`PRAGMA index_info("${idx.name}")`).all() as any[];
      return {
        seq: idx.seq,
        name: idx.name,
        unique: Boolean(idx.unique),
        origin: idx.origin,
        partial: Boolean(idx.partial),
        columns: idxCols.map((ic) => ic.name),
      };
    });

    // 4. Row count
    let rowCount = 0;
    try {
      const countRes = db.query(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as { count: number } | null;
      rowCount = countRes?.count || 0;
    } catch {}

    return {
      tableName,
      type: meta.type,
      sql: meta.sql,
      columns,
      foreignKeys,
      indexes,
      rowCount,
    };
  }

  /**
   * Executes a safe read-only SQL query (SELECT, WITH ... SELECT, PRAGMA).
   */
  readQuery(
    sql: string,
    params: any[] = [],
    options: { limit?: number; offset?: number; dbPath?: string } = {}
  ): SqliteQueryResult {
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();

    // Enforce read-only safety guard
    const isReadOnly =
      upper.startsWith("SELECT") ||
      upper.startsWith("WITH") ||
      upper.startsWith("PRAGMA") ||
      upper.startsWith("EXPLAIN");

    if (!isReadOnly) {
      throw new Error(
        "read_query only permits read-only statements (SELECT, WITH, PRAGMA, EXPLAIN). For mutations (INSERT, UPDATE, DELETE, CREATE, DROP), use write_query."
      );
    }

    const maxLimit = options.limit || 500;
    const offset = options.offset || 0;
    let finalSql = trimmed;

    // Apply pagination if SELECT without explicit LIMIT
    if (upper.startsWith("SELECT") && !upper.includes(" LIMIT ")) {
      finalSql = `${trimmed} LIMIT ${maxLimit} OFFSET ${offset}`;
    }

    const db = this.getDb(options.dbPath);
    const start = performance.now();

    const stmt = db.query(finalSql);
    const rows = stmt.all(...params) as Record<string, any>[];
    const duration = performance.now() - start;

    const columns = rows.length > 0 && rows[0] !== undefined ? Object.keys(rows[0]) : [];

    return {
      columns,
      rows,
      rowCount: rows.length,
      executionTimeMs: Math.round(duration * 100) / 100,
      truncated: rows.length >= maxLimit,
    };
  }

  /**
   * Executes mutating queries (INSERT, UPDATE, DELETE, CREATE TABLE, etc.) in a transaction.
   */
  writeQuery(sql: string, params: any[] = [], dbPath?: string): SqliteWriteResult {
    const db = this.getDb(dbPath);
    const start = performance.now();

    let changes = 0;
    let lastInsertRowid: number | bigint = 0;

    const executeTx = db.transaction(() => {
      const stmt = db.prepare(sql);
      const res = stmt.run(...params);
      changes = res.changes;
      lastInsertRowid = res.lastInsertRowid;
    });

    executeTx();
    const duration = performance.now() - start;

    return {
      changes,
      lastInsertRowid,
      executionTimeMs: Math.round(duration * 100) / 100,
      success: true,
    };
  }

  /**
   * Generates EXPLAIN QUERY PLAN analysis for performance tuning and index optimization.
   */
  explainQuery(sql: string, params: any[] = [], dbPath?: string): SqliteQueryPlanNode[] {
    const db = this.getDb(dbPath);
    const explainSql = `EXPLAIN QUERY PLAN ${sql}`;
    const rows = db.query(explainSql).all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      parent: r.parent,
      notused: r.notused,
      detail: r.detail,
    }));
  }

  /**
   * Generates full DDL schema definition for entire database or a specific table.
   */
  inspectSchema(tableName?: string, dbPath?: string): string {
    const db = this.getDb(dbPath);

    let query = "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL";
    const params: any[] = [];

    if (tableName) {
      query += " AND name = ?";
      params.push(tableName);
    }

    query += " ORDER BY type DESC, name ASC;";

    const rows = db.query(query).all(...params) as Array<{ sql: string }>;
    return rows.map((r) => r.sql + ";").join("\n\n");
  }

  /**
   * Exports table data as formatted JSON or CSV string.
   */
  exportTableData(tableName: string, format: "json" | "csv" = "json", limit = 1000, dbPath?: string): string {
    const db = this.getDb(dbPath);
    const rows = db.query(`SELECT * FROM "${tableName}" LIMIT ${limit}`).all() as Record<string, any>[];

    if (rows.length === 0) return format === "json" ? "[]" : "";

    if (format === "json") {
      return JSON.stringify(rows, null, 2);
    }

    // CSV format
    const headers = Object.keys(rows[0] ?? {});
    const csvLines = [headers.join(",")];

    for (const r of rows) {
      const line = headers.map((h) => {
        const val = r[h];
        if (val === null || val === undefined) return "";
        const str = String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      });
      csvLines.push(line.join(","));
    }

    return csvLines.join("\n");
  }

  closeAll(): void {
    for (const db of this.connections.values()) {
      try {
        db.run("PRAGMA wal_checkpoint(TRUNCATE);");
        db.close();
      } catch {}
    }
    this.connections.clear();
  }
}
