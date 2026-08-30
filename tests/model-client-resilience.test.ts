import { expect, test, describe } from "bun:test";
import { ModelClient } from "../src/client/model-client";
import * as http from "node:http";

describe("ModelClient Resilient Transport & 10 Retries", () => {
  test("Retries on transient HTTP 503 errors and succeeds when server recovers", async () => {
    let requestCount = 0;

    // Create mock HTTP server that fails twice with 503, then succeeds with SSE
    const mockServer = http.createServer((req, res) => {
      requestCount++;
      if (requestCount < 3) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Service Temporarily Unavailable" }));
        return;
      }

      // Success SSE stream on 3rd attempt
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { content: "Resilient Stream Success" } }],
        })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
    });

    const port = await new Promise<number>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as any;
        resolve(addr.port);
      });
    });

    const client = new ModelClient({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: "test-key",
      maxRetries: 10,
    });

    const session = client.newSession();
    const chunks: any[] = [];

    for await (const chunk of session.stream({
      model: "test-model",
      systemPrompt: "test",
      history: [{ id: "1", type: "user_message", content: "hi", createdAt: Date.now() }],
    })) {
      chunks.push(chunk);
    }

    // Verify it received warning events during retries and then completed successfully
    const warnings = chunks.filter((c) => c.type === "warning");
    const textDeltas = chunks.filter((c) => c.type === "text_delta");
    const doneEvent = chunks.find((c) => c.type === "done");

    expect(requestCount).toBe(3);
    expect(warnings.length).toBe(2);
    expect(textDeltas.length).toBe(1);
    expect(textDeltas[0].delta).toBe("Resilient Stream Success");
    expect(doneEvent).toBeDefined();

    mockServer.close();
  });

  test("Fails gracefully after exceeding max 10 retries", async () => {
    let requestCount = 0;

    const mockFailingServer = http.createServer((req, res) => {
      requestCount++;
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad Gateway" }));
    });

    const port = await new Promise<number>((resolve) => {
      mockFailingServer.listen(0, "127.0.0.1", () => {
        const addr = mockFailingServer.address() as any;
        resolve(addr.port);
      });
    });

    const client = new ModelClient({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: "test-key",
      maxRetries: 3, // Set to 3 for quick test execution
    });

    const session = client.newSession();
    const chunks: any[] = [];

    for await (const chunk of session.stream({
      model: "test-model",
      systemPrompt: "test",
      history: [{ id: "1", type: "user_message", content: "hi", createdAt: Date.now() }],
    })) {
      chunks.push(chunk);
    }

    const errorEvent = chunks.find((c) => c.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error.message).toContain("Model API error (502)");
    expect(requestCount).toBe(4); // 1 initial + 3 retries

    mockFailingServer.close();
  });
});
