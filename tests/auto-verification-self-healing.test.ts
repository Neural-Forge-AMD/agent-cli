import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import {
  Session,
  ModelClient,
  type ModelClientSession,
  type ModelSamplingParams,
  type StreamChunkEvent,
  ToolRouter,
  type Event,
  AutoVerifier,
  writeFileTool,
  readFileTool,
} from "../src";

describe("Autonomous Closed-Loop Verification & Self-Healing", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = resolve(tmpdir(), `groupy-verify-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  });

  test("AutoVerifier resolves and executes verification commands accurately", async () => {
    // 1. Mock Node project with typecheck script
    const pkg = {
      name: "test-app",
      scripts: {
        typecheck: "node -e \"console.log('typecheck ok')\"",
      },
    };
    writeFileSync(join(testDir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");

    const verifier = new AutoVerifier({ cwd: testDir });
    const cmd = verifier.resolveVerificationCommand();
    expect(cmd).toBe("npm run typecheck");

    // 2. Custom command execution (async)
    const customVerifier = new AutoVerifier({
      cwd: testDir,
      customCommand: "node -e \"console.log('custom ok')\"",
    });
    const result = await customVerifier.verify(["src/index.ts"]);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("custom ok");

    // 3. Failing verification command (async)
    const failVerifier = new AutoVerifier({
      cwd: testDir,
      customCommand: "node -e \"console.error('syntax error at line 5'); process.exit(1)\"",
    });
    const failResult = await failVerifier.verify(["src/index.ts"]);
    expect(failResult.success).toBe(false);
    expect(failResult.exitCode).toBe(1);
    expect(failResult.output).toContain("syntax error at line 5");

    // 4. Targeted test discovery from modifiedFiles
    mkdirSync(join(testDir, "tests"), { recursive: true });
    writeFileSync(join(testDir, "tests", "auth.test.ts"), "// auth test", "utf8");
    const targeted = verifier.findTargetedTests(["src/auth.ts"]);
    expect(targeted).toContain("tests/auth.test.ts");

    // 5. AbortSignal cancellation
    const controller = new AbortController();
    controller.abort();
    const abortedResult = await customVerifier.verify(["src/index.ts"], controller.signal);
    expect(abortedResult.success).toBe(false);
    expect(abortedResult.reason).toBe("ABORTED");

    // 6. Timeout error message includes explicit timeout detail
    const timeoutVerifier = new AutoVerifier({
      cwd: testDir,
      customCommand: "node -e \"setTimeout(() => {}, 5000)\"",
      timeoutMs: 100,
    });
    const timeoutResult = await timeoutVerifier.verify(["src/index.ts"]);
    expect(timeoutResult.success).toBe(false);
    expect(timeoutResult.output).toContain("[Verification Timeout Error]");
    expect(timeoutResult.output).toContain("exceeded timeout limit of 100ms");
  });

  test("Turn without file mutations does not trigger verification", async () => {
    const tools = new ToolRouter();
    tools.register(readFileTool);

    writeFileSync(join(testDir, "readme.txt"), "hello world", "utf8");

    class MockReadOnlyClient extends ModelClient {
      newSession(): ModelClientSession {
        let step = 0;
        return {
          async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
            step++;
            if (step === 1) {
              yield {
                type: "tool_call",
                callId: "call_read",
                name: "read_file",
                arguments: { path: "readme.txt" },
              };
              yield { type: "done" };
            } else {
              yield { type: "text_delta", delta: "Read file completed." };
              yield { type: "done" };
            }
          },
        };
      }
    }

    const events: Event[] = [];
    const session = new Session({
      cwd: testDir,
      tools,
      modelClient: new MockReadOnlyClient(),
      autoVerification: true,
      autoVerificationCommand: "node -e \"process.exit(0)\"",
      onEvent: (e) => events.push(e),
    });

    await session.prompt("Read the readme");

    await new Promise<void>((res) => {
      const unsub = session.onEvent((e) => {
        if (e.msg.type === "TurnCompleted") {
          unsub();
          res();
        }
      });
    });

    const verifyStarted = events.some((e) => e.msg.type === "VerificationStarted");
    expect(verifyStarted).toBe(false);
  });

  test("Turn with file mutations triggers Auto-Verification and concludes when passing", async () => {
    const tools = new ToolRouter();
    tools.register(writeFileTool);

    class MockWriteClient extends ModelClient {
      newSession(): ModelClientSession {
        let step = 0;
        return {
          async *stream(): AsyncIterable<StreamChunkEvent> {
            step++;
            if (step === 1) {
              yield {
                type: "tool_call",
                callId: "call_write",
                name: "write_file",
                arguments: { path: "app.ts", content: "export const x = 10;" },
              };
              yield { type: "done" };
            } else {
              yield { type: "text_delta", delta: "Wrote code file." };
              yield { type: "done" };
            }
          },
        };
      }
    }

    const events: Event[] = [];
    const session = new Session({
      cwd: testDir,
      tools,
      modelClient: new MockWriteClient(),
      autoVerification: true,
      autoVerificationCommand: "node -e \"console.log('Verification Passed!'); process.exit(0)\"",
      onEvent: (e) => events.push(e),
    });

    await session.prompt("Create app.ts");

    await new Promise<void>((res) => {
      const unsub = session.onEvent((e) => {
        if (e.msg.type === "TurnCompleted") {
          unsub();
          res();
        }
      });
    });

    const verifyStarted = events.find((e) => e.msg.type === "VerificationStarted");
    expect(verifyStarted).toBeDefined();
    expect((verifyStarted?.msg as any).modifiedFiles).toContain("app.ts");

    const verifyCompleted = events.find((e) => e.msg.type === "VerificationCompleted");
    expect(verifyCompleted).toBeDefined();
    expect((verifyCompleted?.msg as any).success).toBe(true);
    expect((verifyCompleted?.msg as any).output).toContain("Verification Passed!");
  });

  test("Verification failure triggers Self-Healing loop and agent fixes code autonomously", async () => {
    const tools = new ToolRouter();
    tools.register(writeFileTool);

    // Verification command checks if app.ts contains 'FIXED_CODE'
    // Step 1: Agent writes broken code (app.ts contains 'BROKEN_CODE') -> Verification fails!
    // Step 2: Engine injects [Automated Self-Verification Failure] -> Agent writes 'FIXED_CODE'!
    // Step 3: Verification re-runs -> Passes!
    const verifyScriptPath = join(testDir, "verify.cjs");
    writeFileSync(
      verifyScriptPath,
      `
      const fs = require('fs');
      const p = '${join(testDir, "app.ts").replace(/\\/g, "\\\\")}';
      if (!fs.existsSync(p)) process.exit(1);
      const text = fs.readFileSync(p, 'utf8');
      if (text.includes('FIXED_CODE')) {
        console.log('All tests passed!');
        process.exit(0);
      } else {
        console.error('SyntaxError: unexpected token in app.ts');
        process.exit(1);
      }
    `,
      "utf8"
    );

    class MockSelfHealingClient extends ModelClient {
      newSession(): ModelClientSession {
        return {
          async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
            const history = params.history;
            const lastUserMsg = [...history].reverse().find((item) => item.type === "user_message");
            const isHealPrompt = lastUserMsg && String(lastUserMsg.content).includes("[Automated Self-Verification Failure]");

            const lastItem = history[history.length - 1];

            if (isHealPrompt) {
              // Agent is responding to self-healing prompt!
              if (lastItem && lastItem.type === "function_call_output") {
                yield { type: "text_delta", delta: "I have repaired the syntax error with FIXED_CODE." };
                yield { type: "done" };
                return;
              }

              // Apply the fix
              yield {
                type: "tool_call",
                callId: "call_heal",
                name: "write_file",
                arguments: { path: "app.ts", content: "export const code = 'FIXED_CODE';" },
              };
              yield { type: "done" };
              return;
            }

            // First turn: write broken code
            if (lastItem && lastItem.type === "function_call_output") {
              yield { type: "text_delta", delta: "Code is initially written." };
              yield { type: "done" };
              return;
            }

            yield {
              type: "tool_call",
              callId: "call_initial",
              name: "write_file",
              arguments: { path: "app.ts", content: "export const code = 'BROKEN_CODE';" },
            };
            yield { type: "done" };
          },
        };
      }
    }

    const events: Event[] = [];
    const session = new Session({
      cwd: testDir,
      tools,
      modelClient: new MockSelfHealingClient(),
      autoVerification: true,
      autoVerificationCommand: `node "${verifyScriptPath}"`,
      onEvent: (e) => events.push(e),
    });

    await session.prompt("Write the initial code");

    await new Promise<void>((res) => {
      const unsub = session.onEvent((e) => {
        if (e.msg.type === "TurnCompleted") {
          unsub();
          res();
        }
      });
    });

    // Verify event flow:
    // 1. Initial verification failed
    const failEvents = events.filter((e) => e.msg.type === "VerificationCompleted" && (e.msg as any).success === false);
    expect(failEvents.length).toBe(1);
    expect((failEvents[0]?.msg as any).output).toContain("SyntaxError: unexpected token in app.ts");

    // 2. SelfHealingStarted was emitted
    const healEvent = events.find((e) => e.msg.type === "SelfHealingStarted");
    expect(healEvent).toBeDefined();
    expect((healEvent?.msg as any).attempt).toBe(1);

    // 3. Second verification succeeded!
    const passEvents = events.filter((e) => e.msg.type === "VerificationCompleted" && (e.msg as any).success === true);
    expect(passEvents.length).toBe(1);
    expect((passEvents[0]?.msg as any).output).toContain("All tests passed!");

    // 4. app.ts now contains FIXED_CODE
    const finalContent = await readFileTool.execute({ path: "app.ts" }, { cwd: testDir, turnId: "verify" });
    expect(finalContent.output).toContain("FIXED_CODE");
  });

  test("autoVerification: false disables verification even if files were modified", async () => {
    const tools = new ToolRouter();
    tools.register(writeFileTool);

    class MockWriteClient extends ModelClient {
      newSession(): ModelClientSession {
        let step = 0;
        return {
          async *stream(): AsyncIterable<StreamChunkEvent> {
            step++;
            if (step === 1) {
              yield {
                type: "tool_call",
                callId: "call_write",
                name: "write_file",
                arguments: { path: "disabled.ts", content: "export const a = 1;" },
              };
              yield { type: "done" };
            } else {
              yield { type: "text_delta", delta: "Done writing." };
              yield { type: "done" };
            }
          },
        };
      }
    }

    const events: Event[] = [];
    const session = new Session({
      cwd: testDir,
      tools,
      modelClient: new MockWriteClient(),
      autoVerification: false,
      autoVerificationCommand: "node -e \"console.log('SHOULD NOT RUN'); process.exit(0)\"",
      onEvent: (e) => events.push(e),
    });

    await session.prompt("Write disabled.ts");

    await new Promise<void>((res) => {
      const unsub = session.onEvent((e) => {
        if (e.msg.type === "TurnCompleted") {
          unsub();
          res();
        }
      });
    });

    const verifyStarted = events.some((e) => e.msg.type === "VerificationStarted");
    expect(verifyStarted).toBe(false);
  });
});
