import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { isSonar } from "../../../domain/helpers/quality/isSonar.js";
import type { ICleanupStore } from "../../../ports/interfaces/cleanup/ICleanupStore.js";
import type { IGitWorkspace } from "../../../ports/interfaces/git/IGitWorkspace.js";
import type { IProgress } from "../../../ports/interfaces/progress/IProgress.js";
import { requireRun } from "../../helpers/cleanup/requireRun.js";

/**
 * Gives up on the open batch: its changes are thrown away and the reason is kept for the report. A batch with
 * SonarQube findings cannot be skipped: it is done only when they are gone, or when the engineer escalates it.
 */
export class SkipBatch {
  constructor(
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
    private readonly progress: IProgress,
  ) {}

  async execute(runId: string, reason: string): Promise<CleanupBatch> {
    const run = requireRun(this.store, runId);
    const batch = this.store.batches(runId).find((b) => b.isOpen);
    if (!batch?.baseSha) throw new DomainError("No batch is open.");
    const smells = batch.findings.filter(isSonar);
    if (smells.length) {
      throw new DomainError(`Batch ${batch.number} has ${smells.length} SonarQube findings, so it cannot be skipped. ` +
        `Fix them and run: aisdlc cleanup check ${run.id}. After the last try the engineer decides.`);
    }
    batch.skip(reason);
    await this.git.resetTo(run.workspace, batch.baseSha);
    this.store.saveBatch(batch);
    this.progress.emit(`batch ${batch.number}`, "info", `skipped: ${reason}`);
    return batch;
  }
}
