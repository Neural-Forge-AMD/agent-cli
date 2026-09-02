/**
 * History Compaction & Context Window Management.
 * Mirrors codex-rs/core/src/compact_remote_v2.rs.
 * 
 * Summarizes older conversation turns when token capacity is approached.
 */

import type { ConversationItem, UserMessageItem } from "../protocol/items";

export interface CompactionConfig {
  maxContextTokens?: number;
  triggerThreshold?: number; // e.g. 0.8 (80% of max tokens)
  retainedRecentTurns?: number;
}

export const DEFAULT_MAX_CONTEXT_TOKENS = 256000;
export const DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS = 180000;

export function estimateItemTokens(item: ConversationItem): number {
  const text =
    item.type === "user_message"
      ? item.content
      : item.type === "agent_message"
      ? item.content
      : item.type === "reasoning"
      ? item.content
      : item.type === "function_call"
      ? JSON.stringify(item.arguments)
      : item.type === "function_call_output"
      ? item.output
      : "";

  // Approximation: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4) + 4;
}

export function estimateTotalTokens(history: ConversationItem[]): number {
  return history.reduce((sum, item) => sum + estimateItemTokens(item), 0);
}

/**
 * Compacts older history items into a single summary item while preserving
 * the most recent N turns.
 */
export function compactHistory(
  history: ConversationItem[],
  retainedRecentItems = 6
): ConversationItem[] {
  if (history.length <= retainedRecentItems) {
    return [...history];
  }

  const itemsToCompact = history.slice(0, history.length - retainedRecentItems);
  const recentItems = history.slice(history.length - retainedRecentItems);

  // Generate structured summary of compacted items
  const summaryParts: string[] = ["### Summary of previous conversation context:"];

  for (const item of itemsToCompact) {
    if (item.type === "user_message") {
      summaryParts.push(`- User: ${item.content.slice(0, 200)}`);
    } else if (item.type === "function_call") {
      summaryParts.push(`- Executed tool: ${item.name}`);
    } else if (item.type === "agent_message") {
      summaryParts.push(`- Assistant: ${item.content.slice(0, 200)}`);
    }
  }

  const summaryItem: UserMessageItem = {
    id: `compacted_${Date.now()}`,
    type: "user_message",
    content: summaryParts.join("\n"),
    createdAt: Date.now(),
  };

  return [summaryItem, ...recentItems];
}
