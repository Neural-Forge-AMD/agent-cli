/**
 * Types & Data Contracts for Local SQLite & Database Inspector MCP Subsystem.
 */

export interface SqliteColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: boolean;
}

export interface SqliteForeignKeyInfo {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

export interface SqliteIndexInfo {
  seq: number;
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns?: string[];
}

export interface SqliteTableSummary {
  name: string;
  type: "table" | "view";
  rowCount: number;
  columnCount: number;
  sql?: string;
}

export interface SqliteTableDetail {
  tableName: string;
  type: "table" | "view";
  sql: string;
  columns: SqliteColumnInfo[];
  foreignKeys: SqliteForeignKeyInfo[];
  indexes: SqliteIndexInfo[];
  rowCount: number;
}

export interface SqliteQueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  executionTimeMs: number;
  truncated: boolean;
}

export interface SqliteWriteResult {
  changes: number;
  lastInsertRowid: number | bigint;
  executionTimeMs: number;
  success: boolean;
}

export interface SqliteQueryPlanNode {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}
