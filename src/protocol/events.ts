/**
 * Real-time event streams emitted by a Groupy session.
 */

import type { ConversationItem } from "./items";

export type SessionStatus = "idle" | "running" | "waiting_approval" | "waiting_user_input" | "interrupted" | "terminated";

export interface PlanItem {
  step: string;
  status: "pending" | "in_progress" | "completed";
}

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
      cachedTokens?: number;
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
      prefixRule?: string[];
    }
  | {
      type: "UserQuestionRequired";
      questionId: string;
      turnId: string;
      question: string;
      options?: string[];
    }
  | {
      type: "PlanUpdated";
      turnId: string;
      explanation?: string;
      plan: PlanItem[];
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
      type: "VerificationStarted";
      turnId: string;
      command: string;
      modifiedFiles: string[];
    }
  | {
      type: "VerificationCompleted";
      turnId: string;
      command: string;
      success: boolean;
      output?: string;
      durationMs?: number;
    }
  | {
      type: "SelfHealingStarted";
      turnId: string;
      attempt: number;
      maxAttempts: number;
      command: string;
      error: string;
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
