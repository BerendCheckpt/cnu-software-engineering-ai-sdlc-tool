import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { ICleanupStore } from "../../../ports/interfaces/cleanup/ICleanupStore.js";
import type { IProgress } from "../../../ports/interfaces/progress/IProgress.js";
import { batchSubject } from "../../helpers/cleanup/batchSubject.js";
import { requireRun } from "../../helpers/cleanup/requireRun.js";
import { withCode } from "../../helpers/solution/withCode.js";
import type { NextStep } from "../../types/cleanup/NextStep.js";
import type { SonarFixLoop } from "../quality/SonarFixLoop.js";

/** The engineer's choice for a waiting batch: another `maxTries` checks, with the change made so far kept. */
export class RetryBatch {
  constructor(
    private readonly store: ICleanupStore,
    private readonly fixLoop: SonarFixLoop,
    private readonly progress: IProgress,
  ) {}

  execute(runId: string): NextStep {
    const run = requireRun(this.store, runId);
    run.requireState("in-progress");
    const batch = this.store.batches(runId).find((b) => b.isWaiting);
    if (!batch) throw new DomainError("No batch waits for the engineer.");
    const subject = batchSubject(batch);
    const left = this.fixLoop.current(subject)?.last?.blocking ?? [];
    this.fixLoop.reopen(subject);
    batch.retry();
    this.store.saveBatch(batch);
    this.progress.emit(`batch ${batch.number}`, "info", "the engineer chose to retry");
    return { kind: "work", run, batch, findings: withCode(run.workspace, left.length ? left : batch.findings) };
  }
}
