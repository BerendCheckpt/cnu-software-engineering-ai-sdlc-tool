import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";

/** `cleanup:<runId>#<batch>`: the fix loop of one batch. */
export function batchSubject(batch: CleanupBatch): string {
  return `cleanup:${batch.runId}#${batch.number}`;
}
