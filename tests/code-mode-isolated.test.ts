import { expect, test, describe } from "bun:test";
import { ToolRouter } from "../src/tools/router";
import { CodeModeRuntime } from "../src/code-mode/runtime";

describe("Code-Mode Batch Runtime (Isolated Execution)", () => {
  test("Executes batch code with tools proxy and camelCase normalization", async () => {
    const router = new ToolRouter();
    router.register({
      name: "echo_data",
      description: "Echoes input text",
      parameters: { type: "object", properties: { text: { type: "string", description: "Input text" } } },
      async execute(args) {
        return { output: `ECHO: ${args.text}` };
      },
    });

    const runtime = new CodeModeRuntime(router);
    const result = await runtime.execute(
      {
        code: `
          const res1 = await tools.echoData({ text: "Hello Batch" });
          const res2 = await tools.echo_data({ text: "Second Batch" });
          text(res1);
          text(res2);
        `,
      },
      { cwd: process.cwd() } as any
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("ECHO: Hello Batch");
    expect(result.output).toContain("ECHO: Second Batch");
    expect(result.toolCallsCount).toBe(2);
  });

  test("Shadows dangerous globals (process, Bun, fetch are undefined)", async () => {
    const router = new ToolRouter();
    const runtime = new CodeModeRuntime(router);

    const result = await runtime.execute(
      {
        code: `
          text("process: " + typeof process);
          text("Bun: " + typeof Bun);
          text("fetch: " + typeof fetch);
        `,
      },
      { cwd: process.cwd() } as any
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("process: undefined");
    expect(result.output).toContain("Bun: undefined");
    expect(result.output).toContain("fetch: undefined");
  });

  test("Persists state across batch steps using store() and load()", async () => {
    const router = new ToolRouter();
    const runtime = new CodeModeRuntime(router);

    const result = await runtime.execute(
      {
        code: `
          store("counter", 42);
          const retrieved = load("counter");
          text("Stored value: " + retrieved);
        `,
      },
      { cwd: process.cwd() } as any
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Stored value: 42");
  });

  test("Watchdog terminates long running / infinite loop code with timeout error", async () => {
    const router = new ToolRouter();
    const runtime = new CodeModeRuntime(router);

    const result = await runtime.execute(
      {
        code: `
          // Simulate infinite loop / long running operation
          await new Promise((resolve) => setTimeout(resolve, 5000));
        `,
        timeoutMs: 150, // Short timeout for testing
      },
      { cwd: process.cwd() } as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out after 150ms");
  });
});
