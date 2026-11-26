import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import type { FindingWithCode } from "../../interfaces/solution/FindingWithCode.js";

export type CheckOutcome =
  | { kind: "committed"; batch: CleanupBatch; fixed: number }
  | { kind: "nothing-changed"; batch: CleanupBatch }
  /**
   * Not committed: something got worse, or a finding of the batch is still open. `history` has one line per earlier
   * failed try, so the next try changes its approach.
   */
  | {
    kind: "regression"; batch: CleanupBatch; problems: string[]; open: FindingWithCode[]; tries: number; maxTries: number;
    history: string[];
  }
  /**
   * The last allowed try failed: the batch keeps its change and waits for the engineer to retry or escalate it.
   * `diagnosis` says per finding left why, for the engineer's choice.
   */
  | {
    kind: "waiting"; batch: CleanupBatch; problems: string[]; open: FindingWithCode[]; tries: number; history: string[];
    diagnosis: string[];
  };
