import type { BatchLimits } from "../../../domain/interfaces/cleanup/BatchLimits.js";
import type { GatePatterns } from "../../../domain/interfaces/cleanup/GatePatterns.js";
import type { FindingCategory } from "../../../domain/types/cleanup/FindingCategory.js";

export interface CleanupPolicy {
  limits: BatchLimits;
  order: FindingCategory[];
  patterns: GatePatterns;
  /** Checks a batch gets before the engineer decides. */
  maxTries: number;
}
