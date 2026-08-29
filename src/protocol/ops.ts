/**
 * Operations (Op) and TurnInput data contracts for Groupy Session.
 * Directly mirrors codex-protocol/src/turn_input.rs & protocol.rs.
 */

export interface TurnInputRequest {
  text: string;
  images?: string[];
  clientId?: string;
  additionalContext?: Record<string, string>;
}

export type TurnInputMode =
  | "start_or_steer"
  | "start_if_idle"
  | "steer"
  | "auto"
  | "step";

export type NotSubmittedReason =
  | "not_idle"
  | "turn_not_found"
  | "unsupported_schema"
  | "session_terminated";

export interface TurnInputSubmission {
  kind: "started" | "steered" | "queued" | "rejected" | "not_submitted";
  turnId?: string;
  reason?: NotSubmittedReason | string;
}

export type Op =
  | {
      type: "TurnInput";
      request: TurnInputRequest;
      mode?: TurnInputMode;
    }
  | {
      type: "Interrupt";
    }
  | {
      type: "ExecApproval";
      approvalId: string;
      approved: boolean;
      feedback?: string;
    }
  | {
      type: "Shutdown";
    };

export interface Submission {
  id: string;
  op: Op;
  createdAt: number;
}
