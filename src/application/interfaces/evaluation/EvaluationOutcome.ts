import { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { LoopOutcome } from "../../types/quality/LoopOutcome.js";
import type { FindingWithCode } from "../solution/FindingWithCode.js";

/** What `eval` found, and what the model has to do next. */
export interface EvaluationOutcome {
  results: EvaluationResult[];
  /** `not-checked`: no gate ran, or the solution is no longer a draft, so there is nothing to fix or count. */
  loop: LoopOutcome | { kind: "not-checked" };
  blocking: FindingWithCode[];
  reported: FindingWithCode[];
  /** Gates that failed and SonarQube issues that could not be read. */
  problems: string[];
  limitations: string[];
}
