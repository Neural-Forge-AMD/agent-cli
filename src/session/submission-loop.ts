/**
 * Async Submission Loop (The Dispatcher).
 * Continuously listens for and handles incoming operations (Op).
 * 
 * Mirrors codex-rs/core/session/handlers.rs (submission_loop).
 */

import type { Session } from "./session";
import type { Submission } from "../protocol/ops";
import { handleTurnInput } from "./turn-input";

export async function submissionLoop(
  session: Session,
  queue: AsyncIterable<Submission>
): Promise<void> {
  for await (const submission of queue) {
    const { op } = submission;

    switch (op.type) {
      case "TurnInput": {
        const text = (op as any).request?.text ?? (op as any).prompt ?? (typeof (op as any).request === "string" ? (op as any).request : "");
        const images = (op as any).request?.images ?? (op as any).images;
        await handleTurnInput(session, {
          text,
          images,
          clientId: (op as any).request?.clientId,
          additionalContext: (op as any).request?.additionalContext,
        });
        break;
      }

      case "Interrupt": {
        session.interrupt();
        break;
      }

      case "ExecApproval": {
        session.resolveApproval(op.approvalId, op.approved);
        break;
      }

      case "Shutdown": {
        session.interrupt();
        session.emitEvent({
          type: "StatusChanged",
          status: "terminated",
        });
        return;
      }
    }
  }
}
