import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";
import type { ICleanupStore } from "../../../ports/interfaces/cleanup/ICleanupStore.js";
import type { IFormatter } from "../../../ports/interfaces/cleanup/IFormatter.js";
import type { IGitWorkspace } from "../../../ports/interfaces/git/IGitWorkspace.js";
import type { IProgress } from "../../../ports/interfaces/progress/IProgress.js";
import { requireRun } from "../../helpers/cleanup/requireRun.js";
import { withCode } from "../../helpers/solution/withCode.js";
import type { NextStep } from "../../types/cleanup/NextStep.js";

/** Starts the next batch, or returns the one still open. The formatting batch runs its tools here, without a model. */
export class NextBatch {
  constructor(
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
    private readonly formatters: IFormatter[],
    private readonly progress: IProgress,
  ) {}

  async execute(runId: string): Promise<NextStep> {
    const run = requireRun(this.store, runId);
    run.requireState("accepted", "in-progress");
    const batches = this.store.batches(runId);

    const waiting = batches.find((b) => b.isWaiting);
    if (waiting) return { kind: "waiting", run, batch: waiting };
    const open = batches.find((b) => b.isOpen);
    if (open) return this.work(run, open);

    const next = batches.find((b) => b.status === "pending");
    if (!next) {
      this.progress.emit("batches", "done", "all handled");
      return { kind: "finished", run };
    }
    next.start(await this.git.head(run.workspace));
    run.moveTo("in-progress");
    this.store.saveBatch(next);
    this.store.saveRun(run);
    this.progress.emit(`batch ${next.number}`, "started",
      `${next.category}, ${next.findings.length} findings (${next.number} of ${batches.length - 1})`);

    if (next.category !== "format") return this.work(run, next);
    const applied: string[] = [];
    for (const formatter of this.formatters) {
      if (await formatter.apply(run.workspace)) applied.push(formatter.name);
    }
    return { kind: "formatted", run, batch: next, applied };
  }

  private work(run: CleanupRun, batch: CleanupBatch): NextStep {
    return { kind: "work", run, batch, findings: withCode(run.workspace, batch.findings) };
  }
}
