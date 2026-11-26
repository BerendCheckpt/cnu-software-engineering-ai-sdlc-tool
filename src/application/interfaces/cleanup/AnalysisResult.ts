import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";

export interface AnalysisResult {
  run: CleanupRun;
  batches: CleanupBatch[];
  planPath: string;
}
