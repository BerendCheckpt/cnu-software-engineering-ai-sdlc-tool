import type { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import type { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";

export interface ICleanupStore {
  saveRun(run: CleanupRun): void;
  run(id: string): CleanupRun | undefined;
  /** The run of this repository on this branch, if there ever was one. */
  runOnBranch(repository: string, branch: string): CleanupRun | undefined;
  saveBatch(batch: CleanupBatch): void;
  batches(runId: string): CleanupBatch[];
}
