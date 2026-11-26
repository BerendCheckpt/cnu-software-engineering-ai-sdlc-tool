import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";
import type { NextStep } from "./NextStep.js";

export type CiOutcome =
  | { kind: "passing" | "pending" | "none"; run: CleanupRun }
  | { kind: "unsupported"; run: CleanupRun; reason: string }
  /** CI failed: the run's `ci` batch is open with the failing checks; fix it, check it, then `finish` pushes again. */
  | { kind: "fixing"; run: CleanupRun; step: NextStep; tries: number; maxTries: number; history: string[] }
  /** CI failed on the last allowed try: the `ci` batch waits for the engineer, as any batch (ADR 0011). */
  | { kind: "waiting"; run: CleanupRun; batch: CleanupBatch; tries: number; diagnosis: string[] }
  /** CI still fails, but the engineer already escalated the `ci` batch; it is not reopened. */
  | { kind: "escalated"; run: CleanupRun; batch: CleanupBatch };
