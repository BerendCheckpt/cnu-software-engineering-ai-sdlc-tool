import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";
import type { ICleanupStore } from "../../../ports/interfaces/cleanup/ICleanupStore.js";
import { requireRun } from "../../helpers/cleanup/requireRun.js";

export class CleanupStatus {
  constructor(private readonly store: ICleanupStore) {}

  execute(runId: string): { run: CleanupRun; batches: CleanupBatch[] } {
    return { run: requireRun(this.store, runId), batches: this.store.batches(runId) };
  }
}
