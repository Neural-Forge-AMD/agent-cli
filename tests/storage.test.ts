import { describe, expect, test, afterEach } from "bun:test";
import { SqliteThreadStore } from "../src/storage/sqlite-store";
import { SessionPersistenceManager } from "../src/storage/manager";
import { Session } from "../src/session/session";
import {
  ModelClient,
  type ModelClientSession,
  type ModelSamplingParams,
  type StreamChunkEvent,
} from "../src/client/model-client";

class MockStorageModelClient extends ModelClient {
  newSession(): ModelClientSession {
    return {
      async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
        yield { type: "text_delta", delta: "Restored turn response successful." };
        yield { type: "done" };
      },
    };
  }
}

describe("SQLite Thread Store & Session Persistence", () => {
  let manager: SessionPersistenceManager | null = null;

  afterEach(() => {
    if (manager) {
      manager.close();
      manager = null;
    }
  });

  test("creates in-memory SQLite schema and saves/retrieves threads", () => {
    const store = new SqliteThreadStore(":memory:");
    manager = new SessionPersistenceManager(store);

    store.saveThread({
      id: "thread_test_001",
      title: "Test Feature Implementation",
      model: "gpt-4o",
      cwd: process.cwd(),
      role: "default",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const retrieved = store.getThread("thread_test_001");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe("Test Feature Implementation");
    expect(retrieved?.model).toBe("gpt-4o");

    const list = store.listThreads();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe("thread_test_001");
  });

  test("auto-saves live Session turns and items to SQLite storage", async () => {
    const store = new SqliteThreadStore(":memory:");
    manager = new SessionPersistenceManager(store);
    const modelClient = new MockStorageModelClient();

    const session = new Session({
      threadId: "thread_live_002",
      modelClient,
    });

    manager.bindSession(session, "reviewer");

    // Execute prompt and wait for turn completion
    await session.promptAndWait("Implement user authentication with JWT");

    // Verify thread record auto-created and title derived
    const thread = store.getThread("thread_live_002");
    expect(thread).not.toBeNull();
    expect(thread?.title).toContain("Implement user authentication");
    expect(thread?.role).toBe("reviewer");

    // Verify items were persisted
    const items = store.getItems("thread_live_002");
    expect(items.length).toBe(2); // UserMessage + AgentMessage

    const userMsg = items.find((i) => i.type === "user_message");
    const agentMsg = items.find((i) => i.type === "agent_message");

    expect(userMsg?.type === "user_message" ? userMsg.content : "").toBe(
      "Implement user authentication with JWT"
    );
    expect(agentMsg?.type === "agent_message" ? agentMsg.content : "").toBe(
      "Restored turn response successful."
    );
  });

  test("resumes past session and continues conversation seamlessly", async () => {
    const store = new SqliteThreadStore(":memory:");
    manager = new SessionPersistenceManager(store);
    const modelClient = new MockStorageModelClient();

    // 1. Initial Session
    const session1 = new Session({
      threadId: "thread_resume_003",
      modelClient,
    });
    manager.bindSession(session1, "default");
    await session1.promptAndWait("Turn 1 prompt");

    // 2. Resume session into new Session instance
    const resumedSession = manager.resumeSession("thread_resume_003", {
      modelClient,
    });

    expect(resumedSession.threadId).toBe("thread_resume_003");
    expect(resumedSession.getHistory().length).toBe(2);

    // 3. Continue prompt in resumed session
    await resumedSession.promptAndWait("Turn 2 follow-up prompt");

    // 4. Verify combined history in SQLite
    const updatedItems = store.getItems("thread_resume_003");
    expect(updatedItems.length).toBe(4); // 2 user + 2 agent messages
  }, 15000);

  test("resumes past session directly into existing active session via resumeIntoSession", async () => {
    const store = new SqliteThreadStore(":memory:");
    manager = new SessionPersistenceManager(store);
    const modelClient = new MockStorageModelClient();

    // 1. Initial Session
    const sessionA = new Session({
      threadId: "thread_orig_005",
      model: "claude-3-5-sonnet",
      modelClient,
    });
    manager.bindSession(sessionA, "default");
    await sessionA.promptAndWait("Hello from original thread");

    // 2. Another active Session that wants to resume thread_orig_005
    const sessionB = new Session({
      threadId: "thread_fresh_006",
      model: "gpt-4o",
      modelClient,
    });
    manager.bindSession(sessionB, "default");
    expect(sessionB.threadId).toBe("thread_fresh_006");
    expect(sessionB.getHistory().length).toBe(0);

    // 3. Resume thread_orig_005 into sessionB
    const restored = manager.resumeIntoSession(sessionB, "thread_orig_005");
    expect(restored).not.toBeNull();
    expect(sessionB.threadId).toBe("thread_orig_005");
    expect(sessionB.model).toBe("claude-3-5-sonnet");
    expect(sessionB.getHistory().length).toBe(2);

    // 4. Submit follow-up turn in sessionB - should persist to thread_orig_005
    await sessionB.promptAndWait("Follow-up in resumed session");
    const items = store.getItems("thread_orig_005");
    expect(items.length).toBe(4);
  }, 15000);

  test("deletes thread and cascades items deletion", () => {
    const store = new SqliteThreadStore(":memory:");
    manager = new SessionPersistenceManager(store);

    store.saveThread({
      id: "thread_del_004",
      title: "To be deleted",
      model: "gpt-4o",
      cwd: process.cwd(),
      role: "default",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const deleted = store.deleteThread("thread_del_004");
    expect(deleted).toBe(true);
    expect(store.getThread("thread_del_004")).toBeNull();
  });
});
