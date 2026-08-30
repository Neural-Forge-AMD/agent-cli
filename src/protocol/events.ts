/**
 * Real-time event streams emitted by a Groupy session.
 */

import type { ConversationItem } from "./items";

export type SessionStatus = "idle" | "running" | "waiting_approval" | "interrupted" | "terminated";

export type EventMsg =
  | {
      type: "SessionConfigured";
      threadId: string;
      model: string;
    }
  | {
      type: "StatusChanged";
      status: SessionStatus;
    }
  | {
      type: "TurnStarted";
      turnId: string;
    }
  | {
      type: "ReasoningDelta";
      turnId: string;
      delta: string;
    }
  | {
      type: "AgentMessageDelta";
      turnId: string;
      delta: string;
    }
  | {
      type: "ItemStarted";
      turnId: string;
      item: Partial<ConversationItem>;
    }
  | {
      type: "ItemCompleted";
      turnId: string;
      item: ConversationItem;
    }
  | {
      type: "TurnCompleted";
      turnId: string;
      totalTokens?: number;
      inputTokens?: number;
      outputTokens?: number;
      contextTokens?: number;
      maxContextTokens?: number;
    }
  | {
      type: "ApprovalRequired";
      approvalId: string;
      turnId: string;
      toolName: string;
      command?: string;
      description: string;
    }
  | {
      type: "ToolCallStarted";
      turnId: string;
      toolName: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "ToolCallFinished";
      turnId: string;
      toolName: string;
      output: string;
      isError?: boolean;
    }
  | {
      type: "Warning";
      message: string;
    }
  | {
      type: "Error";
      turnId?: string;
      message: string;
      code?: string;
    };

export interface Event {
  id: string;
  timestamp: number;
  msg: EventMsg;
}
