import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";

/** What to tell the caller while a batch waits: only the engineer may choose. */
export function waitingMessage(runId: string, batch: CleanupBatch): string {
  return `Batch ${batch.number} still has findings open after its last try and waits for the engineer. Ask them to ` +
    `choose: retry it (aisdlc cleanup retry ${runId}), or a PR with an issue per finding left ` +
    `(aisdlc cleanup escalate ${runId}).`;
}
