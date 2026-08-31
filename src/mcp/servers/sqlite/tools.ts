/**
 * SQLite MCP Tool Definitions & Execution Dispatcher.
 */

import type { McpToolSchema } from "../../types";
import { SqliteEngine } from "./db-engine";

export function getSqliteToolSchemas(): McpToolSchema[] {
  return [
    {
      name: "list_tables",
      description: "List all user tables and views in the SQLite database with row counts and column counts.",
      inputSchema: {
        type: "object",
        properties: {
          dbPath: { type: "string", description: "Optional path to SQLite database file. Defaults to active or auto-discovered DB." },
        },
      },
    },
    {
      name: "describe_table",
      description: "Inspect schema details of a specific table: column names, data types, primary keys, nullability, foreign keys, and indexes.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: { type: "string", description: "Name of the table or view to inspect." },
          dbPath: { type: "string", description: "Optional path to SQLite database file." },
        },
        required: ["tableName"],
      },
    },
    {
      name: "read_query",
      description: "Execute a safe read-only SQL query (SELECT, WITH ... SELECT, PRAGMA) against the database. Mutations are strictly prevented.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The SQL SELECT or PRAGMA query to execute." },
          params: { type: "array", description: "Optional positional parameters for parameterized SQL query." },
          limit: { type: "integer", description: "Maximum number of rows to return (default: 500)." },
          offset: { type: "integer", description: "Row offset for pagination (default: 0)." },
          dbPath: { type: "string", description: "Optional path to SQLite database file." },
        },
        required: ["query"],
      },
    },
    {
      name: "write_query",
      description: "Execute data or schema mutating statements (INSERT, UPDATE, DELETE, CREATE TABLE, ALTER TABLE, DROP TABLE) inside a safe transaction.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The SQL statement to execute." },
          params: { type: "array", description: "Optional positional parameters for parameterized SQL query." },
          dbPath: { type: "string", description: "Optional path to SQLite database file." },
        },
        required: ["query"],
      },
    },
    {
      name: "explain_query",
      description: "Run EXPLAIN QUERY PLAN on a query to analyze SQLite query optimization, index usage, and scan performance.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The SQL query to explain and profile." },
          params: { type: "array", description: "Optional positional parameters." },
          dbPath: { type: "string", description: "Optional path to SQLite database file." },
        },
        required: ["query"],
      },
    },
    {
      name: "inspect_schema",
      description: "Generate full DDL CREATE TABLE definitions for the entire database or a specific table.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: { type: "string", description: "Optional table name to filter schema to a single table." },
          dbPath: { type: "string", description: "Optional path to SQLite database file." },
        },
      },
    },
    {
      name: "export_table_data",
      description: "Export table rows as structured JSON or CSV format for analysis or archiving.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: { type: "string", description: "Name of the table to export." },
          format: { type: "string", enum: ["json", "csv"], description: "Export format (default: 'json')." },
          limit: { type: "integer", description: "Maximum rows to export (default: 1000)." },
          dbPath: { type: "string", description: "Optional path to SQLite database file." },
        },
        required: ["tableName"],
      },
    },
  ];
}

export async function executeSqliteTool(
  engine: SqliteEngine,
  name: string,
  args: Record<string, any>
): Promise<any> {
  const dbPath = args.dbPath ? String(args.dbPath) : undefined;

  switch (name) {
    case "list_tables":
      return engine.listTables(dbPath);

    case "describe_table":
      return engine.describeTable(String(args.tableName), dbPath);

    case "read_query":
      return engine.readQuery(String(args.query || args.sql), args.params || [], {
        limit: args.limit ? Number(args.limit) : undefined,
        offset: args.offset ? Number(args.offset) : undefined,
        dbPath,
      });

    case "write_query":
      return engine.writeQuery(String(args.query || args.sql), args.params || [], dbPath);

    case "explain_query":
      return engine.explainQuery(String(args.query || args.sql), args.params || [], dbPath);

    case "inspect_schema":
      return engine.inspectSchema(args.tableName ? String(args.tableName) : undefined, dbPath);

    case "export_table_data":
      return engine.exportTableData(
        String(args.tableName),
        args.format === "csv" ? "csv" : "json",
        args.limit ? Number(args.limit) : 1000,
        dbPath
      );

    default:
      throw new Error(`Unknown SQLite tool: ${name}`);
  }
}
