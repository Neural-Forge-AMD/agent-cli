/**
 * Core Agentic Execution Loop (runTurn).
 * The "Heart" of the Groupy Engine.
 * 
 * Directly mirrors codex-rs/core/session/turn.rs.
 */

import type { Session } from "./session";
import type { TurnContext } from "./turn-context";
import type { TurnInputRequest } from "../protocol/ops";
import type { FunctionCallItem, FunctionCallOutputItem, AgentMessageItem } from "../protocol/items";
import { TurnAbortedError } from "../protocol/errors";
import { estimateTotalTokens, compactHistory } from "../context/compactor";
import { captureWorldState, formatWorldStatePrompt } from "../context/world-state";
import { buildSystemPrompt } from "../context/instructions";

export async function runTurn(
  session: Session,
  turnContext: TurnContext,
  input: TurnInputRequest
): Promise<void> {
  const { turnId, signal } = turnContext;

  session.emitEvent({
    type: "TurnStarted",
    turnId,
  });

  // Step 1: Pre-sampling Token Check & Auto-Compaction
  const currentHistory = session.getHistory();
  const estimatedTokens = estimateTotalTokens(currentHistory);
  const maxTokenLimit = 80000; // Auto-compact if approaching 80k tokens

  if (estimatedTokens > maxTokenLimit) {
    const compacted = compactHistory(currentHistory);
    session.setHistory(compacted);
    session.emitEvent({
      type: "Warning",
      message: `Auto-compacted conversation history (${estimatedTokens} estimated tokens exceeded limit).`,
    });
  }

  // Step 2: Record initial user input in conversation history
  const userItem = {
    id: `msg_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: "user_message" as const,
    content: typeof input === "string" ? input : input?.text ?? (input as any)?.prompt ?? "",
    images: typeof input === "object" ? input?.images : undefined,
    createdAt: Date.now(),
  };
  session.addHistoryItem(userItem);
  session.emitEvent({
    type: "ItemCompleted",
    turnId,
    item: userItem,
  });

  // Step 3: Capture World State, Memories, Skills & Build Prompt
  const cwd = turnContext.environment.cwd;
  const worldState = await captureWorldState(cwd);
  const memoriesPrompt = session.memoryStore?.formatMemoriesPrompt(cwd);
  const skillsPrompt = session.skillsLoader?.formatSkillsPrompt(cwd);

  const effectiveSystemPrompt = buildSystemPrompt({
    basePrompt: session.systemPrompt,
    worldStatePrompt: formatWorldStatePrompt(worldState),
    memoriesPrompt,
    skillsPrompt,
  });

  let iteration = 0;
  let accumulatedInputTokens = 0;
  let accumulatedOutputTokens = 0;
  const clientSession = session.modelClient.newSession();

  try {
    while (iteration < turnContext.maxIterations) {
      if (signal.aborted) {
        throw new TurnAbortedError();
      }

      iteration++;
      let currentAgentText = "";
      const toolCallRequests: Array<{
        callId: string;
        name: string;
        arguments: Record<string, unknown>;
      }> = [];

      let iterInputTokens = Math.ceil((effectiveSystemPrompt.length + JSON.stringify(session.getHistory()).length) / 4);
      let iterOutputTokens = 0;

      // Stream sampling request
      const stream = clientSession.stream({
        model: turnContext.model,
        systemPrompt: effectiveSystemPrompt,
        history: session.getHistory(),
        tools: turnContext.tools,
        signal,
      });

      for await (const chunk of stream) {
        if (signal.aborted) {
          throw new TurnAbortedError();
        }

        if (chunk.type === "reasoning_delta") {
          session.emitEvent({
            type: "ReasoningDelta",
            turnId,
            delta: chunk.delta,
          });
        } else if (chunk.type === "text_delta") {
          currentAgentText += chunk.delta;
          session.emitEvent({
            type: "AgentMessageDelta",
            turnId,
            delta: chunk.delta,
          });
        } else if (chunk.type === "tool_call") {
          toolCallRequests.push(chunk);
        } else if (chunk.type === "done") {
          if (chunk.inputTokens !== undefined) iterInputTokens = chunk.inputTokens;
          if (chunk.outputTokens !== undefined) iterOutputTokens = chunk.outputTokens;
        } else if (chunk.type === "error") {
          throw chunk.error;
        }
      }

      if (iterOutputTokens === 0) {
        iterOutputTokens = Math.ceil((currentAgentText.length + JSON.stringify(toolCallRequests).length) / 4);
      }

      accumulatedInputTokens += iterInputTokens;
      accumulatedOutputTokens += iterOutputTokens;

      // Record any agent text message generated in this iteration
      if (currentAgentText.trim()) {
        const agentItem: AgentMessageItem = {
          id: `msg_agent_${Date.now()}`,
          type: "agent_message",
          content: currentAgentText,
          createdAt: Date.now(),
        };
        session.addHistoryItem(agentItem);
        session.emitEvent({
          type: "ItemCompleted",
          turnId,
          item: agentItem,
        });
      }

      // If one or more tool calls were requested, execute them and continue the loop
      if (toolCallRequests.length > 0) {
        for (const toolCall of toolCallRequests) {
          const functionCallItem: FunctionCallItem = {
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: "function_call",
            callId: toolCall.callId,
            name: toolCall.name,
            arguments: toolCall.arguments,
            createdAt: Date.now(),
          };

          session.addHistoryItem(functionCallItem);
          session.emitEvent({
            type: "ItemStarted",
            turnId,
            item: functionCallItem,
          });
          session.emitEvent({
            type: "ToolCallStarted" as any,
            turnId,
            toolName: toolCall.name,
            arguments: toolCall.arguments,
          });

          // Execute tool through ToolRouter
          const toolResult = await turnContext.tools.execute(
            toolCall.name,
            toolCall.arguments,
            {
              cwd: turnContext.environment.cwd,
              turnId,
              signal,
              execPolicy: session.execPolicy,
              requestApproval: async (description, command) => {
                const approvalId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                return session.requestApproval({
                  approvalId,
                  turnId,
                  toolName: toolCall.name,
                  description,
                  command,
                });
              },
            }
          );

          const functionOutputItem: FunctionCallOutputItem = {
            id: `out_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: "function_call_output",
            callId: toolCall.callId,
            output: toolResult.output,
            isError: toolResult.isError,
            createdAt: Date.now(),
          };

          session.addHistoryItem(functionOutputItem);
          session.emitEvent({
            type: "ToolCallFinished" as any,
            turnId,
            toolName: toolCall.name,
            output: toolResult.output,
            isError: toolResult.isError,
          });
          session.emitEvent({
            type: "ItemCompleted",
            turnId,
            item: functionOutputItem,
          });
        }

        // Loop continues for model follow-up
        continue;
      }

      // If no tool calls were made, the turn is complete
      break;
    }

    const totalContextTokens = estimateTotalTokens(session.getHistory()) + Math.ceil(effectiveSystemPrompt.length / 4);
    const maxContextTokens = 128000;

    session.emitEvent({
      type: "TurnCompleted",
      turnId,
      inputTokens: accumulatedInputTokens,
      outputTokens: accumulatedOutputTokens,
      totalTokens: accumulatedInputTokens + accumulatedOutputTokens,
      contextTokens: totalContextTokens,
      maxContextTokens,
    });
  } catch (error) {
    const isAborted = error instanceof TurnAbortedError || signal.aborted;
    const message = isAborted ? "Turn was interrupted" : (error instanceof Error ? error.message : String(error));

    session.emitEvent({
      type: "Error",
      turnId,
      message,
      code: isAborted ? "TURN_ABORTED" : "EXECUTION_ERROR",
    });
  } finally {
    session.clearActiveTurn(turnId);
  }
}
