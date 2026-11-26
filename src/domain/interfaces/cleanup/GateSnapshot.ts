import type { EvaluationKind } from "../../types/evaluation/EvaluationKind.js";
import type { TestCounts } from "../evaluation/TestCounts.js";

/** One gate's outcome in a measurement of the workspace. */
export interface GateSnapshot {
  kind: EvaluationKind;
  passed: boolean;
  skipped: boolean;
  tests?: TestCounts;
  coverage?: number;
}
