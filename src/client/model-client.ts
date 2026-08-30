/**
 * Model Gateway Client for Groupy.
 * Connects to OpenAI-compatible endpoints with SSE streaming and tool calling.
 * Supports automated credential discovery from ~/.groupy/credentials.json.
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
}

export interface ModelClientSession {
  stream(params: ModelSamplingParams): AsyncIterable<StreamChunkEvent>;
}

export interface ModelClientConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
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
    const model = params.model || this.config.defaultModel || process.env.GROUPY_MODEL || process.env.OPENAI_MODEL || "groupy";

    if (!apiKey && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1") && !baseUrl.includes("groupy-hub.store")) {
      yield {
        type: "error",
        error: new Error("Authentication required. Please run 'pikaa login' or set GROUPY_API_KEY / OPENAI_API_KEY."),
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

    for (const item of params.history) {
      if (item.type === "user_message") {
        messages.push({
          role: "user",
          content: item.content,
        });
      } else if (item.type === "agent_message") {
        messages.push({
          role: "assistant",
          content: item.content,
        });
      } else if (item.type === "function_call") {
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: item.callId,
              type: "function",
              function: {
                name: item.name,
                arguments: JSON.stringify(item.arguments),
              },
            },
          ],
        });
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

    let response: Response;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: params.signal,
      });
    } catch (fetchErr) {
      yield {
        type: "error",
        error: new Error(`Network error connecting to AI gateway (${baseUrl}): ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`),
      };
      return;
    }

    if (!response.ok) {
      let errBody = "";
      try {
        errBody = await response.text();
      } catch {}
      yield {
        type: "error",
        error: new Error(`Model API error (${response.status}): ${errBody || response.statusText}`),
      };
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

          try {
            const data = JSON.parse(dataStr);
            if (data.usage) {
              usageMetrics = {
                inputTokens: data.usage.prompt_tokens,
                outputTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              };
            }

            const choice = data.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            // Handle reasoning delta (DeepSeek / GLM / o1 / o3 style)
            if (delta.reasoning_content || delta.reasoning) {
              const rDelta = delta.reasoning_content || delta.reasoning;
              yield {
                type: "reasoning_delta",
                delta: rDelta,
              };
            }

            // Handle standard text delta
            if (delta.content) {
              yield {
                type: "text_delta",
                delta: delta.content,
              };
            }

            // Handle streaming tool calls
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!pendingToolCalls.has(idx)) {
                  pendingToolCalls.set(idx, {
                    id: tc.id || `call_${Date.now()}_${idx}`,
                    name: tc.function?.name || "",
                    arguments: tc.function?.arguments || "",
                  });
                } else {
                  const current = pendingToolCalls.get(idx)!;
                  if (tc.id) current.id = tc.id;
                  if (tc.function?.name) {
                    if (!current.name) {
                      current.name = tc.function.name;
                    } else if (tc.function.name !== current.name && !current.name.includes(tc.function.name)) {
                      current.name += tc.function.name;
                    }
                  }
                  if (tc.function?.arguments) {
                    current.arguments += tc.function.arguments;
                  }
                }
              }
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }

      // Final tool call emission if not caught by [DONE]
      for (const tc of pendingToolCalls.values()) {
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

      yield { type: "done" };
    } finally {
      reader.releaseLock();
    }
  }
}
