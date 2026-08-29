/**
 * ThreadManager - Manages multiple active threads.
 * Mirrors ThreadManager in codex-rs/core/thread_manager.rs.
 */

import { GroupyThread } from "./thread";
import type { SessionOptions } from "../session/session";

export class ThreadManager {
  private threads = new Map<string, GroupyThread>();

  createThread(options: SessionOptions = {}): GroupyThread {
    const thread = new GroupyThread(options);
    this.threads.set(thread.threadId, thread);
    return thread;
  }

  getThread(threadId: string): GroupyThread | undefined {
    return this.threads.get(threadId);
  }

  listThreads(): GroupyThread[] {
    return Array.from(this.threads.values());
  }

  removeThread(threadId: string): boolean {
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.session.submit({ type: "Shutdown" });
      return this.threads.delete(threadId);
    }
    return false;
  }
}
