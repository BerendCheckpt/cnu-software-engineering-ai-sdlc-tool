import type { FixLoopState } from "../../types/quality/FixLoopState.js";
import type { FixAttempt } from "./FixAttempt.js";

export interface FixLoopProps {
  /** `solution:<id>` or `cleanup:<runId>#<batch>`. */
  subject: string;
  state: FixLoopState;
  attempts: FixAttempt[];
  /** The GitHub issue, or where its text was written when it could not be created. */
  escalation?: string;
  /** Where the current round of tries starts in `attempts`; earlier ones are kept as history. Undefined is 0. */
  roundStart?: number;
}
