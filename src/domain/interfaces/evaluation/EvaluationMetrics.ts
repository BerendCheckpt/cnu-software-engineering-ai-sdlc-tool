import type { TestCounts } from "./TestCounts.js";

/** Numbers a gate measured, for comparing one run with another. */
export interface EvaluationMetrics {
  tests?: TestCounts;
  /** Line coverage in percent. */
  coverage?: number;
}
