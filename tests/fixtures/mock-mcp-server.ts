/**
 * Standalone mock MCP stdio server used for automated integration tests.
 */

const decoder = new TextDecoder();
let buffer = "";

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk);
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const msg = JSON.parse(trimmed);

      if (msg.method === "initialize") {
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
              resources: { subscribe: false, listChanged: false },
            },
            serverInfo: { name: "mock-mcp-server", version: "1.0.0" },
          },
        };
        process.stdout.write(JSON.stringify(response) + "\n");
      } else if (msg.method === "notifications/initialized") {
        // Notification - no response needed
      } else if (msg.method === "tools/list") {
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [
              {
                name: "query_database",
                description: "Query an external database table",
                inputSchema: {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "SQL query string" },
                  },
                  required: ["query"],
                },
              },
            ],
          },
        };
        process.stdout.write(JSON.stringify(response) + "\n");
      } else if (msg.method === "tools/call") {
        const query = msg.params?.arguments?.query || "default";
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [
              {
                type: "text",
                text: `[Database Result for '${query}']: 42 rows found`,
              },
            ],
          },
        };
        process.stdout.write(JSON.stringify(response) + "\n");
      } else if (msg.method === "resources/list") {
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            resources: [
              {
                uri: "schema://main",
                name: "Database Schema",
                description: "Main DB schema table definitions",
                mimeType: "text/plain",
              },
            ],
          },
        };
        process.stdout.write(JSON.stringify(response) + "\n");
      } else if (msg.method === "resources/read") {
        const uri = msg.params?.uri || "";
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            contents: [
              {
                uri,
                mimeType: "text/plain",
                text: "CREATE TABLE users (id INT, name TEXT);",
              },
            ],
          },
        };
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    } catch (err) {
      console.error("Error processing line in mock MCP server:", err);
    }
  }
}

export {};
