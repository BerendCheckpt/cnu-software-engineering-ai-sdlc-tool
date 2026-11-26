import type { StepStatus } from "../../types/progress/StepStatus.js";

/** One step of a command, as listeners of a session see it. */
export interface StepEvent {
  session: string;
  /** ISO time. */
  at: string;
  step: string;
  status: StepStatus;
  detail?: string;
}
