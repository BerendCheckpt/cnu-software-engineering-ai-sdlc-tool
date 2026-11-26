import type { StepEvent } from "../../../domain/interfaces/progress/StepEvent.js";

/** One listener of step events: the terminal, a session log file. */
export interface IProgressSink {
  write(event: StepEvent): void;
}
