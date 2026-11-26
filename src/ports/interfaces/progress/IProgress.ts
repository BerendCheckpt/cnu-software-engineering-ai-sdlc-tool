import type { StepStatus } from "../../../domain/types/progress/StepStatus.js";

/** Where a command reports its steps, so a terminal or a listener can follow them live. */
export interface IProgress {
  emit(step: string, status: StepStatus, detail?: string): void;
}
