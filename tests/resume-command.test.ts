import { describe, expect, test, afterEach } from "bun:test";
import { SqliteThreadStore } from "../src/storage/sqlite-store";
import { SessionPersistenceManager } from "../src/storage/manager";
import { Session } from "../src/session/session";
import { handleSlashCommand, AVAILABLE_SLASH_COMMANDS, type CommandContext } from "../src/cli/commands";

describe("/resume Slash Command Subsystem", () => {
  let manager: SessionPersistenceManager | null = null;

  afterEach(() => {
    if (manager) {
      manager.close();
      manager = null;
    }
  });

  test("AVAILABLE_SLASH_COMMANDS includes /resume with description", () => {
    const resumeCmd = AVAILABLE_SLASH_COMMANDS.find((c) => c.name === "/resume");
    expect(resumeCmd).toBeDefined();
    expect(resumeCmd?.description).toContain("Resume");
  });

  test("executing /resume with non-existent ID reports error cleanly", async () => {
    const store = new SqliteThreadStore(":memory:");
    manager = new SessionPersistenceManager(store);
    const session = new Session({ threadId: "active_thread" });

    const ctx: CommandContext = {
      session,
      storageManager: manager,
    };

    const handled = await handleSlashCommand("/resume thread_fake_999", ctx);
    expect(handled).toBe(true);
    expect(session.threadId).toBe("active_thread");
  });

  test("executing /resume <thread_id> restores session history and switches threadId", async () => {
    const store = new SqliteThreadStore(":memory:");
    manager = new SessionPersistenceManager(store);

    // Save a thread and items
    store.saveThread({
      id: "thread_past_123",
      title: "Past Chat About Architecture",
      model: "claude-3-7-sonnet",
      cwd: process.cwd(),
      role: "default",
      status: "active",
      createdAt: Date.now() - 10000,
      updatedAt: Date.now() - 5000,
    });

    store.appendItem("thread_past_123", "turn_1", 1, {
      id: "item_msg_1",
      type: "user_message",
      content: "Explain microservices architecture",
      createdAt: Date.now() - 9000,
    });
    store.appendItem("thread_past_123", "turn_1", 2, {
      id: "item_msg_2",
      type: "agent_message",
      content: "Microservices split apps into decoupled services.",
      createdAt: Date.now() - 8000,
    });

    // Active session
    const activeSession = new Session({
      threadId: "current_blank_session",
      model: "gpt-4o",
    });
    manager.bindSession(activeSession);

    const ctx: CommandContext = {
      session: activeSession,
      storageManager: manager,
    };

    const handled = await handleSlashCommand("/resume thread_past_123", ctx);
    expect(handled).toBe(true);
    expect(activeSession.threadId).toBe("thread_past_123");
    expect(activeSession.model).toBe("claude-3-7-sonnet");
    expect(activeSession.getHistory().length).toBe(2);

    const firstMsg = activeSession.getHistory()[0];
    expect(firstMsg?.type === "user_message" ? firstMsg.content : "").toBe("Explain microservices architecture");
  });

  test("executing /resume with prefix matching restores corresponding session", async () => {
    const store = new SqliteThreadStore(":memory:");
    manager = new SessionPersistenceManager(store);

    store.saveThread({
      id: "thread_unique_prefix_abc",
      title: "Unique Prefix Thread",
      model: "deepseek-r1",
      cwd: process.cwd(),
      role: "default",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const activeSession = new Session({ threadId: "init_session" });
    manager.bindSession(activeSession);

    const ctx: CommandContext = {
      session: activeSession,
      storageManager: manager,
    };

    const handled = await handleSlashCommand("/resume thread_unique", ctx);
    expect(handled).toBe(true);
    expect(activeSession.threadId).toBe("thread_unique_prefix_abc");
    expect(activeSession.model).toBe("deepseek-r1");
  });

  test("executing /resume without arguments in non-TTY mode lists saved sessions", async () => {
    const store = new SqliteThreadStore(":memory:");
    manager = new SessionPersistenceManager(store);

    store.saveThread({
      id: "thread_list_test",
      title: "Listed Thread",
      model: "gemini-2.5-flash",
      cwd: process.cwd(),
      role: "default",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const activeSession = new Session({ threadId: "init_session" });
    const ctx: CommandContext = {
      session: activeSession,
      storageManager: manager,
    };

    const handled = await handleSlashCommand("/resume", ctx);
    expect(handled).toBe(true);
  });
});
