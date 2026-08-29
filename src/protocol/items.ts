/**
 * Conversation items and history representation.
 * Follows Codex's immutable history item structures.
 */

export interface UserMessageItem {
  id: string;
  type: "user_message";
  content: string;
  images?: string[];
  createdAt: number;
}

export interface AgentMessageItem {
  id: string;
  type: "agent_message";
  content: string;
  createdAt: number;
}

export interface ReasoningItem {
  id: string;
  type: "reasoning";
  content: string;
  createdAt: number;
}

export interface FunctionCallItem {
  id: string;
  type: "function_call";
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  createdAt: number;
}

export interface FunctionCallOutputItem {
  id: string;
  type: "function_call_output";
  callId: string;
  output: string;
  isError?: boolean;
  createdAt: number;
}

export type ConversationItem =
  | UserMessageItem
  | AgentMessageItem
  | ReasoningItem
  | FunctionCallItem
  | FunctionCallOutputItem;

export type Item = ConversationItem;
