import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";

export interface EscalationOutcome {
  batch: CleanupBatch;
  /** True when the batch's change made nothing worse and was committed with the findings it did fix. */
  committed: boolean;
  /** Why the change was not committed. */
  problems: string[];
  /** One link per finding left, or where its issue text is when the issue could not be opened. */
  issues: string[];
}
