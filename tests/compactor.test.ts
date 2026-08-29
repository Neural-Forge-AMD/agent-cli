import { describe, expect, test } from "bun:test";
import { compactHistory, estimateTotalTokens } from "../src/context/compactor";
import type { ConversationItem } from "../src/protocol/items";

describe("History Compactor", () => {
  test("estimates tokens accurately and compacts older history items", () => {
    const history: ConversationItem[] = [];

    for (let i = 1; i <= 10; i++) {
      history.push({
        id: `user_${i}`,
        type: "user_message",
        content: `User query ${i} with some long text to fill tokens.`,
        createdAt: Date.now(),
      });
      history.push({
        id: `agent_${i}`,
        type: "agent_message",
        content: `Agent response ${i} answering the query.`,
        createdAt: Date.now(),
      });
    }

    expect(history.length).toBe(20);
    const initialTokens = estimateTotalTokens(history);
    expect(initialTokens).toBeGreaterThan(100);

    // Retain only last 4 items
    const compacted = compactHistory(history, 4);

    expect(compacted.length).toBe(5); // 1 summary item + 4 recent items
    expect(compacted[0]?.type).toBe("user_message");
    expect((compacted[0] as any)?.content).toContain("Summary of previous conversation context");
    expect(compacted[1]?.id).toBe("user_9");
  });
});
