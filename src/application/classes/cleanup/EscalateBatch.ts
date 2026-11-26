import type { DiffClassifier } from "../../../domain/classes/cleanup/DiffClassifier.js";
import { ValidPr } from "../../../domain/classes/cleanup/ValidPr.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { ICleanupGateFactory } from "../../../ports/interfaces/cleanup/ICleanupGateFactory.js";
import type { ICleanupStore } from "../../../ports/interfaces/cleanup/ICleanupStore.js";
import type { IGitWorkspace } from "../../../ports/interfaces/git/IGitWorkspace.js";
import type { ISandbox } from "../../../ports/interfaces/process/ISandbox.js";
import type { IProgress } from "../../../ports/interfaces/progress/IProgress.js";
import type { IRepoMirror } from "../../../ports/interfaces/repository/IRepoMirror.js";
import { batchSubject } from "../../helpers/cleanup/batchSubject.js";
import { commitMessage } from "../../helpers/cleanup/commitMessage.js";
import { requireRun } from "../../helpers/cleanup/requireRun.js";
import { stillOpen } from "../../helpers/cleanup/stillOpen.js";
import type { EscalationOutcome } from "../../interfaces/cleanup/EscalationOutcome.js";
import type { SonarFixLoop } from "../quality/SonarFixLoop.js";
import { MeasureWorkspace } from "./MeasureWorkspace.js";

/**
 * The engineer's other choice for a waiting batch: a PR with an issue per finding left. The batch's change is
 * committed when it made nothing worse, and reset otherwise. The run then goes on with the next batch; `finish`
 * opens the PR, which lists the issues.
 */
export class EscalateBatch {
  constructor(
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
    private readonly sandbox: ISandbox,
    private readonly measure: MeasureWorkspace,
    private readonly classifier: DiffClassifier,
    private readonly fixLoop: SonarFixLoop,
    private readonly mirror: IRepoMirror,
    private readonly gates: ICleanupGateFactory,
    private readonly progress: IProgress,
  ) {}

  async execute(runId: string): Promise<EscalationOutcome> {
    const run = requireRun(this.store, runId);
    run.requireState("in-progress");
    const batch = this.store.batches(runId).find((b) => b.isWaiting);
    if (!batch?.baseSha) throw new DomainError("No batch waits for the engineer.");
    const step = `escalate batch ${batch.number}`;
    this.progress.emit(step, "started", batch.category);

    const diff = await this.git.diffSince(run.workspace, batch.baseSha);
    const gates = this.classifier.classify(diff, batch.category);
    let left = batch.findings;
    let problems = ["nothing changed"];
    let commitSha: string | undefined;
    let limitations = run.reference.limitations ?? [];
    if (diff.trim()) {
      await this.sandbox.ensureAvailable();
      const current = await this.measure.execute(run.id, run.workspace);
      limitations = current.limitations ?? [];
      problems = ValidPr.problems(run.reference, current, { fewerTestsApproved: gates.some((g) => g.gate === "tests") });
      if (problems.length) {
        await this.git.resetTo(run.workspace, batch.baseSha);
      } else {
        // Failing CI checks are never in the local measurement: they are left until CI says otherwise.
        left = batch.category === "ci" ? batch.findings : stillOpen(batch.findings, current);
        commitSha = await this.git.commit(run.workspace, commitMessage(batch, ValidPr.fixed(run.reference, current).length));
        run.acceptMeasurement(current);
      }
    }

    const issues = await this.fixLoop.openIssues(batchSubject(batch), left, async () => ({
      task: `clean-up ${run.id}, batch ${batch.number} (${batch.category}) of ${run.repository}`,
      details: [],
      repository: run.repository,
      remoteUrl: await this.mirror.remoteUrl(run.repository).catch(() => undefined),
      location: [
        `Branch: ${run.branch}, from ${run.baseBranch}; \`aisdlc cleanup finish\` pushes it and opens the PR`,
        commitSha
          ? `The batch's partial fix is commit ${commitSha}.`
          : `The batch's change was reset to ${batch.baseSha}: ${problems.join("; ")}.`,
      ],
      ...sonarLink(this.gates.forRun(run.id).sonarProjectUrl),
      diff,
      reproduce: `aisdlc cleanup status ${run.id}`,
      limitations,
    }));
    batch.escalate(issues.length ? issues.join(", ") : "no finding was left", commitSha, gates);
    this.store.saveBatch(batch);
    this.store.saveRun(run);
    this.progress.emit(step, "done", `${commitSha ? "partial fix committed" : "change reset"}, ${issues.length} issues`);
    return { batch, committed: Boolean(commitSha), problems: commitSha ? [] : problems, issues };
  }
}

function sonarLink(url: string | undefined): { sonarProjectUrl?: string } {
  return url ? { sonarProjectUrl: url } : {};
}
