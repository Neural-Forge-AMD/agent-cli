/**
 * GroupyThread - User-facing thread handle.
 * Wraps Session and exposes clean event subscriptions and submission methods.
 * 
 * Mirrors CodexThread in codex-rs/core/codex_thread.rs.
 */

import { Session, type SessionOptions } from "../session/session";
import type { Event } from "../protocol/events";
import type { Op, TurnInputSubmission } from "../protocol/ops";
import type { ConversationItem } from "../protocol/items";

export class GroupyThread {
  public readonly session: Session;

  constructor(options: SessionOptions = {}) {
    this.session = new Session(options);
  }

  get threadId(): string {
    return this.session.threadId;
  }

  get model(): string {
    return this.session.model;
  }

  get cwd(): string {
    return this.session.cwd;
  }

  /**
   * Submit a user prompt to the thread
   */
  async prompt(text: string, images?: string[]): Promise<TurnInputSubmission> {
    return this.session.prompt(text, images);
  }

  /**
   * Submit a low-level operation (Interrupt, ExecApproval, Shutdown, etc.)
   */
  async submit(op: Op): Promise<string> {
    return this.session.submit(op);
  }

  /**
   * Interrupt current active turn
   */
  interrupt(): void {
    this.session.interrupt();
  }

  /**
   * Subscribe to real-time events emitted by the thread
   */
  onEvent(listener: (event: Event) => void): () => void {
    return this.session.onEvent(listener);
  }

  /**
   * Retrieve conversation history
   */
  getHistory(): ConversationItem[] {
    return this.session.getHistory();
  }
}
