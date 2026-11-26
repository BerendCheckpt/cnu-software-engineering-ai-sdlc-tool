import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import type { ICleanupStore } from "../../../ports/interfaces/cleanup/ICleanupStore.js";
import type { FailedCheck } from "../../../ports/interfaces/git/FailedCheck.js";
import type { ICiChecks } from "../../../ports/interfaces/git/ICiChecks.js";
import type { IGitWorkspace } from "../../../ports/interfaces/git/IGitWorkspace.js";
import type { IProgress } from "../../../ports/interfaces/progress/IProgress.js";
import { batchSubject } from "../../helpers/cleanup/batchSubject.js";
import { diagnose } from "../../helpers/cleanup/diagnose.js";
import { requireRun } from "../../helpers/cleanup/requireRun.js";
import { triedBefore } from "../../helpers/cleanup/triedBefore.js";
import { withCode } from "../../helpers/solution/withCode.js";
import type { CiOutcome } from "../../types/cleanup/CiOutcome.js";
import type { SonarFixLoop } from "../quality/SonarFixLoop.js";

/** A failing CI check as a finding of the `ci` batch: the check's name is its rule, the tail of its log its message. */
function ciFinding(check: FailedCheck): Finding {
  return { source: "ci", rule: check.name, category: "bug", severity: "HIGH", file: "", message: check.log };
}

/**
 * Reads the CI of the run's pull request once (ADR 0012). A failing CI opens the run's one `ci` batch with the failing
 * checks; every failed CI round is a try of that batch, so after `maxTries` the engineer decides.
 */
export class CheckCi {
  constructor(
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
    private readonly ci: ICiChecks,
    private readonly fixLoop: SonarFixLoop,
    private readonly maxTries: number,
    private readonly progress: IProgress,
  ) {}

  async execute(runId: string): Promise<CiOutcome> {
    const run = requireRun(this.store, runId);
    run.requireState("pushed");
    if (!run.pullRequest) throw new DomainError(`Clean-up ${run.id} has no pull request. Open it with: cleanup finish`);
    this.progress.emit("ci", "started", run.pullRequest);
    const result = await this.ci.read(run.workspace, run.pullRequest);
    run.recordCi(result.state);
    if (result.state !== "failing") {
      this.store.saveRun(run);
      this.progress.emit("ci", result.state === "passing" ? "done" : "info", result.state);
      return result.state === "unsupported" ? { kind: "unsupported", run, reason: result.reason } : { kind: result.state, run };
    }

    const batches = this.store.batches(run.id);
    const existing = batches.find((b) => b.category === "ci");
    if (existing && existing.status !== "done") {
      this.store.saveRun(run);
      this.progress.emit("ci", "failed", `batch ${existing.number} is ${existing.status}`);
      return { kind: "escalated", run, batch: existing };
    }
    const findings = result.failing.map(ciFinding);
    const head = await this.git.head(run.workspace);
    const batch = existing ?? CleanupBatch.plan(run.id, Math.max(-1, ...batches.map((b) => b.number)) + 1, "ci", findings);
    if (existing) existing.reopenForCi(findings, head);
    else batch.start(head);
    run.moveTo("in-progress");

    // A failed CI round is a failed try of the `ci` batch, kept where the model cannot reset it.
    const subject = batchSubject(batch);
    const loop = this.fixLoop.checkBatch(subject, { blocking: findings, reported: [], problems: [] }, this.maxTries);
    batch.recordFailedCheck();
    const failed = this.fixLoop.current(subject)?.failedAttempts ?? [];
    const summary = findings.map((f) => f.rule).join(", ");
    if (loop.kind === "engineer") {
      batch.waitForEngineer();
      this.store.saveBatch(batch);
      this.store.saveRun(run);
      this.progress.emit("ci", "failed", `try ${loop.tries} of ${loop.maxTries}, waiting for the engineer: ${summary}`);
      return { kind: "waiting", run, batch, tries: loop.tries, diagnosis: diagnose(failed) };
    }
    this.store.saveBatch(batch);
    this.store.saveRun(run);
    const tries = loop.kind === "fix-required" ? loop.tries : 0;
    this.progress.emit("ci", "failed", `try ${tries} of ${this.maxTries}: ${summary}`);
    return {
      kind: "fixing", run, step: { kind: "work", run, batch, findings: withCode(run.workspace, findings) },
      tries, maxTries: this.maxTries, history: triedBefore(failed.slice(0, -1)),
    };
  }
}
