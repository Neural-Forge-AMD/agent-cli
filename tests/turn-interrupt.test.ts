import { describe, expect, test } from "bun:test";
import {
  Session,
  ModelClient,
  type ModelClientSession,
  type ModelSamplingParams,
  type StreamChunkEvent,
} from "../src";

class SlowMockModelClient extends ModelClient {
  newSession(): ModelClientSession {
    return {
      async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
        for (let i = 0; i < 20; i++) {
          if (params.signal?.aborted) {
            throw new Error("Aborted");
          }
          await new Promise((r) => setTimeout(r, 20));
          yield {
            type: "text_delta",
            delta: `Chunk ${i} `,
          };
        }
        yield { type: "done" };
      },
    };
  }
}

describe("Turn Interrupt & Steering", () => {
  test("interrupts an active turn gracefully", async () => {
    const session = new Session({
      modelClient: new SlowMockModelClient(),
    });

    const submission = await session.prompt("Long running task");
    expect(submission.kind).toBe("started");

    // Interrupt quickly
    await new Promise((r) => setTimeout(r, 40));
    session.interrupt();

    // Verify status becomes interrupted or idle
    expect(session.getActiveTurn()).toBeNull();
  });

  test("steers an active turn when a new prompt is sent while running", async () => {
    const session = new Session({
      modelClient: new SlowMockModelClient(),
    });

    const sub1 = await session.prompt("Task 1");
    expect(sub1.kind).toBe("started");

    const sub2 = await session.prompt("Steering guidance");
    expect(sub2.kind).toBe("steered");
    expect(sub2.turnId).toBe(sub1.turnId);

    session.interrupt();
  });
});
