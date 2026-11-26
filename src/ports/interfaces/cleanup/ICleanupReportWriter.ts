import type { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import type { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";
import type { DocReference } from "../docs/DocReference.js";

/** Fixed templates for the clean-up plan and the PR body. */
export interface ICleanupReportWriter {
  plan(run: CleanupRun, batches: CleanupBatch[]): string;
  /** `docs` maps a security finding's rule to what the pulled docs say about it; undefined when no docs are pulled. */
  report(run: CleanupRun, batches: CleanupBatch[], docs?: Map<string, DocReference>, sonarProject?: string): string;
}
