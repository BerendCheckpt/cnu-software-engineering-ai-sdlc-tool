import type { DiffClassifier } from "../../../domain/classes/cleanup/DiffClassifier.js";
import { ValidPr } from "../../../domain/classes/cleanup/ValidPr.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { ICleanupStore } from "../../../ports/interfaces/cleanup/ICleanupStore.js";
import type { IGitWorkspace } from "../../../ports/interfaces/git/IGitWorkspace.js";
import type { ISandbox } from "../../../ports/interfaces/process/ISandbox.js";
import type { IProgress } from "../../../ports/interfaces/progress/IProgress.js";
import { batchSubject } from "../../helpers/cleanup/batchSubject.js";
import { commitMessage } from "../../helpers/cleanup/commitMessage.js";
import { diagnose } from "../../helpers/cleanup/diagnose.js";
import { requireRun } from "../../helpers/cleanup/requireRun.js";
import { stillOpen } from "../../helpers/cleanup/stillOpen.js";
import { triedBefore } from "../../helpers/cleanup/triedBefore.js";
import { waitingMessage } from "../../helpers/cleanup/waitingMessage.js";
import { withCode } from "../../helpers/solution/withCode.js";
import type { CheckOutcome } from "../../types/cleanup/CheckOutcome.js";
import type { SonarFixLoop } from "../quality/SonarFixLoop.js";
import { MeasureWorkspace } from "./MeasureWorkspace.js";

/**
 * Measures the open batch and decides what happens to it. A batch is done only when every one of its findings is
 * gone and nothing got worse; then it is committed. Otherwise it goes back to the model, up to `maxTries` checks;
 * when the last one fails, the batch waits for the engineer (ADR 0011). A diff that touches tests, dependencies or
 * security-sensitive code is committed too, with what it touched kept on the batch, so the PR flags it.
 */
export class CheckBatch {
  constructor(
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
    private readonly sandbox: ISandbox,
    private readonly measure: MeasureWorkspace,
    private readonly classifier: DiffClassifier,
    private readonly fixLoop: SonarFixLoop,
    private readonly maxTries: number,
    private readonly progress: IProgress,
  ) {}

  async execute(runId: string): Promise<CheckOutcome> {
    const run = requireRun(this.store, runId);
    run.requireState("in-progress");
    const batches = this.store.batches(runId);
    const waiting = batches.find((b) => b.isWaiting);
    if (waiting) throw new DomainError(waitingMessage(run.id, waiting));
    const batch = batches.find((b) => b.isOpen);
    if (!batch?.baseSha) throw new DomainError("No batch is open. Start one with: cleanup next");
    const step = `check batch ${batch.number}`;
    this.progress.emit(step, "started", batch.category);

    const diff = await this.git.diffSince(run.workspace, batch.baseSha);
    if (!diff.trim()) {
      if (batch.category !== "format") {
        this.progress.emit(step, "info", "nothing changed");
        return { kind: "nothing-changed", batch };
      }
      batch.complete(undefined, []);
      this.store.saveBatch(batch);
      this.progress.emit(step, "done", "nothing to format");
      return { kind: "committed", batch, fixed: 0 };
    }

    await this.sandbox.ensureAvailable();
    // Tests, dependencies or security-sensitive code: not a stop, but flagged in the PR for the reviewer.
    const gates = this.classifier.classify(diff, batch.category);
    const current = await this.measure.execute(run.id, run.workspace);
    const problems = ValidPr.problems(run.reference, current,
      { fewerTestsApproved: gates.some((g) => g.gate === "tests") });
    // Every finding of the batch must be gone, whatever its severity; new ones are already a problem above.
    const open = stillOpen(batch.findings, current);
    const subject = batchSubject(batch);
    const loop = this.fixLoop.checkBatch(subject,
      { blocking: open, reported: [], problems, changed: this.classifier.files(diff) }, this.maxTries);
    if (loop.kind !== "clean") {
      const summary = [...problems, ...open.map((f) => `${f.rule} still open`)].slice(0, 3).join("; ");
      // Every failed check counts on the batch, the last one too: it is the batch's count over all rounds.
      batch.recordFailedCheck();
      const failed = this.fixLoop.current(subject)?.failedAttempts ?? [];
      const history = triedBefore(failed.slice(0, -1));
      if (loop.kind === "engineer") {
        batch.waitForEngineer();
        this.store.saveBatch(batch);
        this.progress.emit(step, "failed", `try ${loop.tries} of ${loop.maxTries}, waiting for the engineer: ${summary}`);
        return {
          kind: "waiting", batch, problems, open: withCode(run.workspace, open), tries: loop.tries, history,
          diagnosis: diagnose(failed),
        };
      }
      this.store.saveBatch(batch);
      this.progress.emit(step, "failed", `try ${loop.tries} of ${loop.maxTries}: ${summary}`);
      return {
        kind: "regression", batch, problems, open: withCode(run.workspace, open), tries: loop.tries, maxTries: loop.maxTries,
        history,
      };
    }

    const fixed = ValidPr.fixed(run.reference, current).length;
    batch.complete(await this.git.commit(run.workspace, commitMessage(batch, fixed)), gates);
    run.acceptMeasurement(current);
    this.store.saveBatch(batch);
    this.store.saveRun(run);
    this.progress.emit(step, "done", `committed, ${fixed} fixed` +
      (gates.length ? `; flagged for review: ${gates.map((g) => g.gate).join(", ")}` : ""));
    return { kind: "committed", batch, fixed };
  }
}
