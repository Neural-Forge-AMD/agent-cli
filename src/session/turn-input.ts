/**
 * Handles turn-input admission and steering.
 * Decides whether to start a new turn, steer an active one, or queue.
 * 
 * Mirrors codex-rs/core/session/turn_input.rs.
 */

import type { Session } from "./session";
import { TurnContext } from "./turn-context";
import { runTurn } from "./turn";
import type { TurnInputRequest, TurnInputSubmission } from "../protocol/ops";

export async function handleTurnInput(
  session: Session,
  request: TurnInputRequest
): Promise<TurnInputSubmission> {
  const activeTurn = session.getActiveTurn();

  if (!activeTurn) {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const turnContext = new TurnContext(
      turnId,
      session.model,
      session.tools,
      { cwd: session.cwd }
    );

    session.setActiveTurn(turnContext);

    // Run the turn asynchronously (non-blocking actor style)
    runTurn(session, turnContext, request).catch((err) => {
      session.emitEvent({
        type: "Error",
        turnId,
        message: `Unhandled turn error: ${err instanceof Error ? err.message : String(err)}`,
      });
    });

    return {
      kind: "started",
      turnId,
    };
  }

  // If there is already an active turn, we steer it by injecting context or queueing
  session.addHistoryItem({
    id: `steer_${Date.now()}`,
    type: "user_message",
    content: `[Steering Guidance]: ${request.text}`,
    images: request.images,
    createdAt: Date.now(),
  });

  return {
    kind: "steered",
    turnId: activeTurn.turnId,
  };
}
