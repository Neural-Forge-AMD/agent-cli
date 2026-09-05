import { describe, it, expect } from "bun:test";
import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { SqliteEngine } from "../src/mcp/servers/sqlite/db-engine";
import { getSqliteToolSchemas } from "../src/mcp/servers/sqlite/tools";
import { SqliteMcpServer } from "../src/mcp/servers/sqlite/server";
import { SQLITE_MCP_SERVER_PATH } from "../src/mcp/servers/sqlite";
import { McpManager } from "../src/mcp/manager";
import { ToolRouter } from "../src/tools/router";

function safeUnlink(path: string) {
  try {
    if (existsSync(path)) unlinkSync(path);
    const wal = `${path}-wal`;
    const shm = `${path}-shm`;
    if (existsSync(wal)) unlinkSync(wal);
    if (existsSync(shm)) unlinkSync(shm);
  } catch {}
}

describe("Local SQLite & Database Inspector MCP Subsystem", () => {
  it("should perform full schema creation, writes, and reads with safe query guards", () => {
    const testDbPath = resolve(tmpdir(), `test_db_1_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.sqlite`);
    const engine = new SqliteEngine(testDbPath);

    try {
      // 1. Create table via writeQuery
      const createRes = engine.writeQuery(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL,
          role TEXT DEFAULT 'user',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      expect(createRes.success).toBe(true);

      // 2. Insert rows
      const insertRes = engine.writeQuery(
        `INSERT INTO users (username, email, role) VALUES (?, ?, ?), (?, ?, ?)`,
        ["alice", "alice@example.com", "admin", "bob", "bob@example.com", "user"]
      );
      expect(insertRes.changes).toBe(2);
      expect(insertRes.lastInsertRowid).toBeGreaterThanOrEqual(1);

      // 3. List tables
      const tables = engine.listTables();
      expect(tables.length).toBe(1);
      expect(tables[0]?.name).toBe("users");
      expect(tables[0]?.rowCount).toBe(2);
      expect(tables[0]?.columnCount).toBe(5);

      // 4. Describe table
      const detail = engine.describeTable("users");
      expect(detail.tableName).toBe("users");
      expect(detail.columns.length).toBe(5);
      const pkCol = detail.columns.find((c) => c.name === "id");
      expect(pkCol?.pk).toBe(true);

      // 5. Read query with pagination
      const readRes = engine.readQuery(`SELECT id, username, role FROM users ORDER BY id ASC`);
      expect(readRes.rowCount).toBe(2);
      expect(readRes.columns).toEqual(["id", "username", "role"]);
      expect(readRes.rows[0]?.username).toBe("alice");
      expect(readRes.rows[1]?.username).toBe("bob");

      // 6. Enforce read-only safety guard in readQuery
      expect(() => {
        engine.readQuery(`DELETE FROM users WHERE username = 'bob'`);
      }).toThrow();

      // 7. Explain query plan
      const plan = engine.explainQuery(`SELECT * FROM users WHERE username = 'alice'`);
      expect(plan.length).toBeGreaterThan(0);

      // 8. Inspect schema
      const ddl = engine.inspectSchema("users");
      expect(ddl).toContain("CREATE TABLE users");

      // 9. Export table data as CSV and JSON
      const jsonExport = engine.exportTableData("users", "json");
      expect(jsonExport).toContain("alice@example.com");

      const csvExport = engine.exportTableData("users", "csv");
      expect(csvExport).toContain("username,email");
      expect(csvExport).toContain("alice,alice@example.com");
    } finally {
      engine.closeAll();
      safeUnlink(testDbPath);
    }
  });

  it("should export full suite of SQLite MCP tool schemas", () => {
    const tools = getSqliteToolSchemas();
    expect(tools.length).toBeGreaterThanOrEqual(7);

    const names = tools.map((t) => t.name);
    expect(names).toContain("list_tables");
    expect(names).toContain("describe_table");
    expect(names).toContain("read_query");
    expect(names).toContain("write_query");
    expect(names).toContain("explain_query");
    expect(names).toContain("inspect_schema");
    expect(names).toContain("export_table_data");
  });

  it("should respond to MCP JSON-RPC 2.0 protocol in SqliteMcpServer", async () => {
    const testDbPath = resolve(tmpdir(), `test_db_2_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.sqlite`);
    const server = new SqliteMcpServer(testDbPath);

    try {
      // 1. initialize
      const initRes = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" } as any,
      });
      expect(initRes).not.toBeNull();
      expect((initRes?.result as any)?.serverInfo?.name).toBe("sqlite-local-mcp");

      // 2. tools/list
      const listRes = await server.handleRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      expect((listRes?.result as any)?.tools?.length).toBeGreaterThanOrEqual(7);

      // 3. tools/call write_query
      const writeRes = await server.handleRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "write_query",
          arguments: { query: "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);" },
        },
      });
      expect((writeRes?.result as any)?.content?.[0]?.text).toContain("success");

      // 4. tools/call list_tables
      const listTablesRes = await server.handleRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "list_tables", arguments: {} },
      });
      expect((listTablesRes?.result as any)?.content?.[0]?.text).toContain("items");
    } finally {
      server.close();
      safeUnlink(testDbPath);
    }
  });

  it("should connect SQLite MCP server via McpManager stdio transport seamlessly", async () => {
    const testDbPath = resolve(tmpdir(), `test_db_3_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.sqlite`);
    const manager = new McpManager();
    const router = new ToolRouter();

    try {
      await manager.registerServer("sqlite", {
        type: "stdio",
        command: process.execPath,
        args: [SQLITE_MCP_SERVER_PATH, testDbPath],
      });

      const client = manager.getClient("sqlite");
      expect(client).toBeDefined();
      expect(client?.isConnected()).toBe(true);

      const tools = client?.getTools() || [];
      expect(tools.length).toBeGreaterThanOrEqual(7);

      manager.registerToolsIntoRouter(router);

      // SQLite has <= 8 tools (7 tools), so eager-loaded directly into router!
      expect(manager.isServerLazy("sqlite")).toBe(false);
      expect(router.has("mcp__sqlite__list_tables")).toBe(true);
      expect(router.has("mcp__sqlite__read_query")).toBe(true);
      expect(router.has("mcp__sqlite__write_query")).toBe(true);
      expect(router.has("mcp__sqlite__describe_table")).toBe(true);

      // Verify formatMcpPrompt includes sqlite under Eager section
      const prompt = manager.formatMcpPrompt();
      expect(prompt).toContain("<mcp_servers>");
      expect(prompt).toContain("# sqlite");
      expect(prompt).toContain("Eager:");
      expect(prompt).toContain("mcp__sqlite__read_query");

      // Verify tool execution through ToolRouter
      const writeTool = router.get("mcp__sqlite__write_query")!;
      const res = await writeTool.execute(
        { query: "CREATE TABLE test_e2e (id INT, val TEXT); INSERT INTO test_e2e VALUES (1, 'hello');" },
        {} as any
      );
      expect(res.output).toContain("success");
    } finally {
      await manager.closeAll();
      safeUnlink(testDbPath);
    }
  });
});
