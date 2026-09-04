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

  test("does not orphan function_call_output items when cutoff lands in the middle of a tool turn", () => {
    const history: ConversationItem[] = [
      { id: "u1", type: "user_message", content: "first question", createdAt: 1 },
      { id: "a1", type: "agent_message", content: "first answer", createdAt: 2 },
      { id: "u2", type: "user_message", content: "second question", createdAt: 3 },
      { id: "c1", type: "function_call", callId: "call_1", name: "read_file", arguments: { path: "a.ts" }, createdAt: 4 },
      { id: "o1", type: "function_call_output", callId: "call_1", output: "content of a.ts", isError: false, createdAt: 5 },
      { id: "a2", type: "agent_message", content: "analyzed a.ts", createdAt: 6 },
    ];

    // Slicing last 2 items would normally take [o1, a2], orphaning o1
    const compacted = compactHistory(history, 2);

    // Verified: recent items must begin with clean turn boundary (u2) or not start with orphaned o1
    expect(compacted[0]?.type).toBe("user_message"); // summary item
    expect(compacted[1]?.type).not.toBe("function_call_output");
    expect(compacted[1]?.id).toBe("u2");
  });
});
