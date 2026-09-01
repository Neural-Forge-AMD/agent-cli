/**
 * Model Gateway Client for Groupy.
 * Connects to OpenAI-compatible endpoints with SSE streaming, tool calling, and resilient retries.
 * Supports automated credential discovery from ~/.groupy/credentials.json.
 * 
 * Directly mirrors codex-rs/core/src/client.rs and responses_retry.rs.
 */

import type { ConversationItem } from "../protocol/items";
import type { ToolRouter } from "../tools/router";
import { CredentialsStore } from "../auth/store";

export type StreamChunkEvent =
  | {
      type: "text_delta";
      delta: string;
    }
  | {
      type: "reasoning_delta";
      delta: string;
    }
  | {
      type: "tool_call";
      callId: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "done";
      totalTokens?: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  | {
      type: "warning";
      message: string;
    }
  | {
      type: "error";
      error: Error;
    };

export interface ModelSamplingParams {
  model: string;
  systemPrompt: string;
  history: ConversationItem[];
  tools?: ToolRouter | any;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  maxRetries?: number;
}

export interface ModelClientSession {
  stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent>;
}

export interface ModelClientConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  maxRetries?: number;
}

export class ModelClient {
  constructor(public readonly config: ModelClientConfig = {}) {}

  newSession(): ModelClientSession {
    return new DefaultModelClientSession(this.config);
  }
}

export class DefaultModelClientSession implements ModelClientSession {
  constructor(private config: ModelClientConfig) {}

  async *stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent> {
    const savedCreds = new CredentialsStore().load();
    const apiKey =
      this.config.apiKey ||
      process.env.GROUPY_API_KEY ||
      process.env.OPENAI_API_KEY ||
      savedCreds?.accessToken ||
      "";
    const baseUrl = (
      this.config.baseUrl ||
      process.env.GROUPY_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      savedCreds?.baseUrl ||
      "https://api.groupy-hub.store/v1"
    ).replace(/\/+$/, "");
    const model =
      params.model ||
      this.config.defaultModel ||
      process.env.GROUPY_MODEL ||
      process.env.OPENAI_MODEL ||
      "groupy";

    if (
      !apiKey &&
      !baseUrl.includes("localhost") &&
      !baseUrl.includes("127.0.0.1") &&
      !baseUrl.includes("groupy-hub.store")
    ) {
      yield {
        type: "error",
        error: new Error(
          "Authentication required. Please run 'pikaa login' or set GROUPY_API_KEY / OPENAI_API_KEY."
        ),
      };
      return;
    }

    // Build messages from history
    const messages: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
      tool_call_id?: string;
    }> = [
      {
        role: "system",
        content: params.systemPrompt,
      },
    ];

    for (let i = 0; i < params.history.length; i++) {
      const item = params.history[i]!;

      if (item.type === "user_message") {
        messages.push({
          role: "user",
          content: item.content,
        });
      } else if (item.type === "agent_message") {
        // Strip any residual raw <think> tags from history
        const cleanedContent = item.content
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .replace(/<\/?think>/gi, "")
          .trim();

        // Check if subsequent items are function calls belonging to this turn
        const toolCalls: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }> = [];

        let j = i + 1;
        while (j < params.history.length && params.history[j]?.type === "function_call") {
          const fc = params.history[j] as any;
          toolCalls.push({
            id: fc.callId,
            type: "function",
            function: {
              name: fc.name,
              arguments: JSON.stringify(fc.arguments),
            },
          });
          j++;
        }

        if (toolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: cleanedContent || null,
            tool_calls: toolCalls,
          });
          i = j - 1; // advance past consumed function calls
        } else if (cleanedContent) {
          messages.push({
            role: "assistant",
            content: cleanedContent,
          });
        }
      } else if (item.type === "function_call") {
        // Standalone function call without preceding agent_message
        const toolCalls: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }> = [
          {
            id: item.callId,
            type: "function",
            function: {
              name: item.name,
              arguments: JSON.stringify(item.arguments),
            },
          },
        ];

        let j = i + 1;
        while (j < params.history.length && params.history[j]?.type === "function_call") {
          const fc = params.history[j] as any;
          toolCalls.push({
            id: fc.callId,
            type: "function",
            function: {
              name: fc.name,
              arguments: JSON.stringify(fc.arguments),
            },
          });
          j++;
        }

        messages.push({
          role: "assistant",
          content: null,
          tool_calls: toolCalls,
        });
        i = j - 1;
      } else if (item.type === "function_call_output") {
        messages.push({
          role: "tool",
          tool_call_id: item.callId,
          content: item.output,
        });
      }
    }

    // Tools definition
    const toolsPayload =
      typeof params.tools?.toModelToolsSchema === "function"
        ? params.tools.toModelToolsSchema()
        : typeof params.tools?.toOpenAISpec === "function"
        ? params.tools.toOpenAISpec()
        : Array.isArray(params.tools)
        ? params.tools
        : [];

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: params.temperature ?? 0.2,
    };

    if (toolsPayload && toolsPayload.length > 0) {
      body.tools = toolsPayload;
      body.tool_choice = "auto";
    }

    const maxRetries = params.maxRetries ?? this.config.maxRetries ?? 10; // User-requested 10 retries
    let attempt = 0;
    let response: Response | null = null;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // Resilient retry loop with exponential backoff
    while (attempt <= maxRetries) {
      if (params.signal?.aborted) {
        return;
      }

      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: params.signal,
        });

        if (response.ok) {
          break; // Successful connection
        }

        // Retry on 429, 500, 502, 503, 504
        const isRetryable =
          response.status === 429 ||
          response.status === 500 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        if (!isRetryable || attempt >= maxRetries) {
          let errBody = "";
          try {
            errBody = await response.text();
          } catch {}
          yield {
            type: "error",
            error: new Error(
              `Model API error (${response.status}): ${errBody || response.statusText}`
            ),
          };
          return;
        }

        attempt++;
        const isTestEnv =
          process.env.NODE_ENV === "test" ||
          process.env.BUN_ENV === "test" ||
          Boolean(process.env.GROUPY_FAST_RETRY);
        const backoffMs = isTestEnv
          ? Math.min(25 * attempt, 100)
          : Math.min(300 * Math.pow(1.5, attempt) + Math.random() * 200, 5000);
        yield {
          type: "warning",
          message: `Model API returned HTTP ${response.status}. Retrying attempt ${attempt}/${maxRetries} in ${Math.round(backoffMs)}ms...`,
        };
        await new Promise((r) => setTimeout(r, backoffMs));
      } catch (fetchErr) {
        if (params.signal?.aborted) {
          return;
        }

        attempt++;
        if (attempt > maxRetries) {
          yield {
            type: "error",
            error: new Error(
              `Network error connecting to AI gateway (${baseUrl}) after ${maxRetries} retries: ${
                fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
              }`
            ),
          };
          return;
        }

        const isTestEnv =
          process.env.NODE_ENV === "test" ||
          process.env.BUN_ENV === "test" ||
          Boolean(process.env.GROUPY_FAST_RETRY);
        const backoffMs = isTestEnv
          ? Math.min(25 * attempt, 100)
          : Math.min(300 * Math.pow(1.5, attempt) + Math.random() * 200, 5000);
        yield {
          type: "warning",
          message: `Network error connecting to model provider (${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}). Retrying attempt ${attempt}/${maxRetries} in ${Math.round(backoffMs)}ms...`,
        };
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    if (!response || !response.ok) {
      return;
    }

    if (!response.body) {
      yield {
        type: "error",
        error: new Error("Response body is empty from model provider"),
      };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usageMetrics: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};

    let inThinkTag = false;

    // Accumulators for multi-chunk tool calls
    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const dataStr = trimmed.slice(6);
          if (dataStr === "[DONE]") {
            // Emit any collected tool calls
            for (const tc of pendingToolCalls.values()) {
              if (!tc.name || !tc.name.trim()) continue;
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(tc.arguments);
              } catch {}
              yield {
                type: "tool_call",
                callId: tc.id,
                name: tc.name,
                arguments: parsedArgs,
              };
            }
            pendingToolCalls.clear();

            yield {
              type: "done",
              inputTokens: usageMetrics.inputTokens,
              outputTokens: usageMetrics.outputTokens,
              totalTokens: usageMetrics.totalTokens,
            };
            return;
          }

          let parsed: any;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (parsed.usage) {
            usageMetrics = {
              inputTokens: parsed.usage.prompt_tokens,
              outputTokens: parsed.usage.completion_tokens,
              totalTokens: parsed.usage.total_tokens,
            };
          }

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          // 1. Reasoning Delta
          if (delta.reasoning_content || delta.reasoning) {
            yield {
              type: "reasoning_delta",
              delta: delta.reasoning_content || delta.reasoning,
            };
          }

          // 2. Text Delta & Embedded <think> tag demuxing
          if (delta.content) {
            let contentStr: string = delta.content;

            while (contentStr.length > 0) {
              if (!inThinkTag) {
                const thinkStart = contentStr.indexOf("<think>");
                if (thinkStart === -1) {
                  // Check if there is an orphan </think> tag without opening
                  const strayEnd = contentStr.indexOf("</think>");
                  if (strayEnd !== -1) {
                    const before = contentStr.slice(0, strayEnd);
                    const after = contentStr.slice(strayEnd + 8);
                    contentStr = before + after;
                    continue;
                  }
                  yield {
                    type: "text_delta",
                    delta: contentStr,
                  };
                  break;
                } else {
                  if (thinkStart > 0) {
                    yield {
                      type: "text_delta",
                      delta: contentStr.slice(0, thinkStart),
                    };
                  }
                  inThinkTag = true;
                  contentStr = contentStr.slice(thinkStart + 7);
                }
              } else {
                const thinkEnd = contentStr.indexOf("</think>");
                if (thinkEnd === -1) {
                  yield {
                    type: "reasoning_delta",
                    delta: contentStr,
                  };
                  break;
                } else {
                  if (thinkEnd > 0) {
                    yield {
                      type: "reasoning_delta",
                      delta: contentStr.slice(0, thinkEnd),
                    };
                  }
                  inThinkTag = false;
                  contentStr = contentStr.slice(thinkEnd + 8);
                }
              }
            }
          }

          // 3. Tool Calls (incremental chunks)
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              const existing = pendingToolCalls.get(index) || {
                id: tc.id || `call_${Date.now()}_${index}`,
                name: "",
                arguments: "",
              };

              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;

              pendingToolCalls.set(index, existing);
            }
          }
        }
      }

      // Final flush if [DONE] was missing
      for (const tc of pendingToolCalls.values()) {
        if (!tc.name || !tc.name.trim()) continue;
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.arguments);
        } catch {}
        yield {
          type: "tool_call",
          callId: tc.id,
          name: tc.name,
          arguments: parsedArgs,
        };
      }

      yield {
        type: "done",
        inputTokens: usageMetrics.inputTokens,
        outputTokens: usageMetrics.outputTokens,
        totalTokens: usageMetrics.totalTokens,
      };
    } catch (streamErr) {
      yield {
        type: "error",
        error:
          streamErr instanceof Error ? streamErr : new Error(String(streamErr)),
      };
    }
  }
}
