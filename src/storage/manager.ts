/**
 * SessionPersistenceManager - Coordinates auto-saving live Session events
 * to SQLite Thread Store and resuming past sessions.
 * 
 * Directly mirrors codex-rs/thread-store/src/store.rs & local/live_writer.rs.
 */

import { SqliteThreadStore } from "./sqlite-store";
import { Session, type SessionOptions } from "../session/session";
import type { ThreadRecord, ThreadListOptions, RestoredSessionData } from "./types";
import type { Item } from "../protocol/items";

export class SessionPersistenceManager {
  public readonly store: SqliteThreadStore;
  private unsubscribers: Array<() => void> = [];

  constructor(storeOrPath?: SqliteThreadStore | string) {
    if (storeOrPath instanceof SqliteThreadStore) {
      this.store = storeOrPath;
    } else {
      this.store = new SqliteThreadStore(storeOrPath);
    }
  }

  /**
   * Attaches automatic persistence hooks to an active Session
   */
  bindSession(session: Session, role = "default"): () => void {
    const threadId = session.threadId;

    // Ensure thread record exists
    const existing = this.store.getThread(threadId);
    if (!existing) {
      this.store.saveThread({
        id: threadId,
        title: "New Session",
        model: session.model,
        cwd: session.cwd,
        role,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // Initialize sequence counter from existing items count
    const existingItems = this.store.getItems(threadId);
    let seq = existingItems.length;

    const unsub = session.onEvent((event) => {
      const msg = event.msg;

      if (msg.type === "ItemCompleted") {
        const item: Item = msg.item;
        seq++;
        this.store.appendItem(threadId, "turn_active", seq, item);

        // Derive title from first user message if still default
        if (item.type === "user_message" && seq <= 2) {
          const title = item.content.slice(0, 60).replace(/\n/g, " ");
          this.store.updateThreadTitle(threadId, title);
        }
      } else if (msg.type === "TurnCompleted") {
        this.store.updateThreadTimestamp(threadId);
      }
    });

    this.unsubscribers.push(unsub);
    return unsub;
  }

  /**
   * Resumes a past session from SQLite storage
   */
  resumeSession(threadId: string, overrides: Partial<SessionOptions> = {}): Session {
    const restored = this.store.restoreSession(threadId);

    const session = new Session({
      threadId: restored.thread.id,
      model: overrides.model || restored.thread.model,
      cwd: overrides.cwd || restored.thread.cwd,
      tools: overrides.tools,
      skillsLoader: overrides.skillsLoader,
      memoryStore: overrides.memoryStore,
      mcpManager: overrides.mcpManager,
      modelClient: overrides.modelClient,
      systemPrompt: overrides.systemPrompt,
      initialHistory: restored.items,
    });

    this.bindSession(session, restored.thread.role);
    return session;
  }

  loadSession(threadId: string) {
    try {
      return this.store.restoreSession(threadId);
    } catch {
      return null;
    }
  }

  /**
   * Detaches active auto-save event listeners from the current session.
   */
  unbindSession(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.unsubscribers = [];
  }

  /**
   * Resumes a past session directly into an existing active Session instance.
   * Restores historical items, switches the thread identifier, and re-binds persistence hooks.
   */
  resumeIntoSession(session: Session, threadId: string): RestoredSessionData | null {
    const restored = this.loadSession(threadId);
    if (!restored) return null;

    this.unbindSession();
    session.threadId = restored.thread.id;
    session.setHistory(restored.items);
    if (restored.thread.model) {
      session.model = restored.thread.model;
    }
    this.bindSession(session, restored.thread.role);
    return restored;
  }

  listSessions(options?: ThreadListOptions): ThreadRecord[] {
    return this.store.listThreads(options);
  }

  deleteSession(threadId: string): boolean {
    return this.store.deleteThread(threadId);
  }

  close(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.unsubscribers = [];
    this.store.close();
  }
}
