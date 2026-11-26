import type { StepDecision } from "../../types/migration/StepDecision.js";
import type { CodeLocation } from "./CodeLocation.js";

export interface MigrationStep {
  heading: string;
  docUrl: string;
  locations: CodeLocation[];
  decision: StepDecision;
  /** Why the step was dropped or what the question is; empty for a `port` step. */
  note?: string;
}
