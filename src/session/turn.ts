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
import {
  estimateTotalTokens,
  compactHistory,
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS,
} from "../context/compactor";
import { captureWorldState, formatWorldStatePrompt } from "../context/world-state";
import { buildSystemPrompt } from "../context/instructions";
import { globalEphemeralWorkspace } from "../workspace/ephemeral";
import { AutoVerifier } from "../verification";

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
  const maxTokenLimit = DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS; // Auto-compact if approaching 180k tokens

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

  const cwd = turnContext.environment.cwd;
  const worldState = await captureWorldState(cwd);
  const memoriesPrompt = session.memoryStore?.formatMemoriesPrompt(cwd);
  const skillsPrompt = session.skillsLoader?.formatSkillsPrompt(cwd);
  const mcpPrompt = session.mcpManager?.formatMcpPrompt();

  const effectiveSystemPrompt = buildSystemPrompt({
    basePrompt: session.systemPrompt || undefined,
    worldStatePrompt: formatWorldStatePrompt(worldState),
    memoriesPrompt,
    skillsPrompt,
    mcpPrompt,
    isOrchestrator: session.tools.has("spawn_agent"),
    cwd,
  });

  let iteration = 0;
  let accumulatedInputTokens = 0;
  let accumulatedOutputTokens = 0;
  let accumulatedCachedTokens = 0;
  const clientSession = session.modelClient.newSession();
  const modifiedFiles = new Set<string>();
  let selfHealingAttempts = 0;
  let hasRunVerification = false;

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

      // Stream sampling request with Prompt Caching support
      const stream = clientSession.stream({
        model: turnContext.model,
        systemPrompt: effectiveSystemPrompt,
        history: session.getHistory(),
        tools: turnContext.tools,
        signal,
        enablePromptCache: true,
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
          if (chunk.cachedTokens !== undefined) accumulatedCachedTokens += chunk.cachedTokens;
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
        const validCalls: Array<{
          callId: string;
          name: string;
          arguments: Record<string, unknown>;
          functionCallItem: FunctionCallItem;
        }> = [];

        // 1. Stage and append all function_call items to conversation history first.
        // This preserves strict OpenAI/Anthropic parallel tool call schema compliance,
        // allowing model-client to reconstruct a single assistant message containing all tool_calls.
        for (const toolCall of toolCallRequests) {
          if (!toolCall.name || !toolCall.name.trim()) continue;

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

          validCalls.push({
            callId: toolCall.callId,
            name: toolCall.name,
            arguments: toolCall.arguments,
            functionCallItem,
          });
        }

        // 2. Execute tools and append their outputs
        for (const toolCall of validCalls) {
          // Execute tool through ToolRouter
          const toolResult = await turnContext.tools.execute(
            toolCall.name,
            toolCall.arguments,
            {
              cwd: turnContext.environment.cwd,
              turnId,
              signal,
              execPolicy: session.execPolicy,
              mode: session.collaborationMode,
              permissionMode: session.permissionMode,
              onFileModified: (p) => {
                if (p) {
                  modifiedFiles.add(p);
                  hasRunVerification = false;
                }
              },
              onPlanUpdate: (plan, explanation) => {
                session.emitEvent({
                  type: "PlanUpdated",
                  turnId,
                  explanation,
                  plan,
                });
              },
              requestApproval: async (description, command, prefixRule) => {
                const approvalId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                return session.requestApproval({
                  approvalId,
                  turnId,
                  toolName: toolCall.name,
                  description,
                  command,
                });
              },
              requestInput: async (question, options) => {
                const questionId = `quest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                return session.requestUserQuestion({
                  questionId,
                  turnId,
                  question,
                  options,
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

          if (!toolResult.isError) {
            if (toolCall.name === "apply_patch" || toolCall.name === "write_file") {
              const p = String(toolCall.arguments?.path || "");
              if (p) {
                modifiedFiles.add(p);
                hasRunVerification = false;
              }
            }
          }

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

      // If no tool calls were made, check if files were modified and require autonomous verification
      if (
        session.autoVerification &&
        modifiedFiles.size > 0 &&
        !hasRunVerification &&
        iteration < turnContext.maxIterations
      ) {
        const verifier = new AutoVerifier({
          cwd,
          customCommand: session.autoVerificationCommand,
        });
        const command = verifier.resolveVerificationCommand();

        if (command) {
          session.emitEvent({
            type: "VerificationStarted",
            turnId,
            command,
            modifiedFiles: Array.from(modifiedFiles),
          });

          const vResult = verifier.verify(Array.from(modifiedFiles));

          session.emitEvent({
            type: "VerificationCompleted",
            turnId,
            command: vResult.command,
            success: vResult.success,
            output: vResult.output,
            durationMs: vResult.durationMs,
          });

          if (!vResult.success) {
            if (selfHealingAttempts < session.maxSelfHealingAttempts) {
              selfHealingAttempts++;
              session.emitEvent({
                type: "SelfHealingStarted",
                turnId,
                attempt: selfHealingAttempts,
                maxAttempts: session.maxSelfHealingAttempts,
                command: vResult.command,
                error: vResult.output,
              });

              // Inject high-signal self-verification failure into context to trigger self-healing
              const feedbackMsg = `[Automated Self-Verification Failure]
Verification command '${vResult.command}' failed with exit code ${vResult.exitCode}.

Error trace / compiler output:
${vResult.output}

Modified file(s) in this turn: ${Array.from(modifiedFiles).join(", ")}

Self-Healing Directive (Attempt ${selfHealingAttempts} of ${session.maxSelfHealingAttempts}):
1. Review the error trace above carefully and locate the exact root cause.
2. Formulate and apply the necessary surgical fix using 'apply_patch' or 'write_file'.
3. Do NOT conclude the turn or report to the user until this error is resolved and verification passes cleanly.`;

              session.addHistoryItem({
                id: `msg_heal_${Date.now()}`,
                type: "user_message",
                content: feedbackMsg,
                createdAt: Date.now(),
              });

              continue;
            } else {
              session.emitEvent({
                type: "Warning",
                message: `Auto-verification failed after ${selfHealingAttempts} self-healing attempts for command: ${vResult.command}`,
              });
              hasRunVerification = true;
            }
          } else {
            hasRunVerification = true;
          }
        }
      }

      // If no tool calls were made, check if the response was completely empty
      if (!currentAgentText.trim() && toolCallRequests.length === 0) {
        if (iteration === 1 && iteration < turnContext.maxIterations) {
          // Model returned empty completion / stalled; re-prompt automatically with systematic ReAct guidance
          session.addHistoryItem({
            id: `msg_nudge_${Date.now()}`,
            type: "user_message",
            content: `[Systematic ReAct Nudge]: No tool actions or answers were produced in this iteration.
1. Review the user's objective and determine the immediate next action.
2. If more context is required, invoke an exploration tool ('read_file', 'list_dir', 'grep_search', 'find_files').
3. If ready to answer or implement, call the required mutating tool or deliver your full, concrete response now.`,
            createdAt: Date.now(),
          });
          continue;
        }
      }

      // Turn is complete
      break;
    }

    const totalContextTokens = estimateTotalTokens(session.getHistory()) + Math.ceil(effectiveSystemPrompt.length / 4);
    const maxContextTokens = DEFAULT_MAX_CONTEXT_TOKENS;

    session.emitEvent({
      type: "TurnCompleted",
      turnId,
      inputTokens: accumulatedInputTokens,
      outputTokens: accumulatedOutputTokens,
      totalTokens: accumulatedInputTokens + accumulatedOutputTokens,
      cachedTokens: accumulatedCachedTokens > 0 ? accumulatedCachedTokens : undefined,
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
    globalEphemeralWorkspace.cleanupTurn(turnId);
    globalEphemeralWorkspace.cleanRootResidue(turnContext.environment.cwd);
  }
}
