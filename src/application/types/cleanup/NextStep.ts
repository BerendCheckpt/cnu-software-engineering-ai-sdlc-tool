import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";
import type { FindingWithCode } from "../../interfaces/solution/FindingWithCode.js";

// ---------------------------------------------------------------------------------------------------------------

export type NextStep =
  | { kind: "work"; run: CleanupRun; batch: CleanupBatch; findings: FindingWithCode[] }
  | { kind: "formatted"; run: CleanupRun; batch: CleanupBatch; applied: string[] }
  /** A batch failed its last try; nothing goes on until the engineer retries or escalates it. */
  | { kind: "waiting"; run: CleanupRun; batch: CleanupBatch }
  | { kind: "finished"; run: CleanupRun };
