import { writeFileSync } from "node:fs";
import { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";
import { ValidPr } from "../../../domain/classes/cleanup/ValidPr.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { findingKey } from "../../../domain/helpers/cleanup/findingKey.js";
import { isRequired } from "../../../domain/helpers/cleanup/isRequired.js";
import { isSecurityFinding } from "../../../domain/helpers/cleanup/isSecurityFinding.js";
import { isSonar } from "../../../domain/helpers/quality/isSonar.js";
import type { ICleanupGateFactory } from "../../../ports/interfaces/cleanup/ICleanupGateFactory.js";
import type { ICleanupReportWriter } from "../../../ports/interfaces/cleanup/ICleanupReportWriter.js";
import type { ICleanupStore } from "../../../ports/interfaces/cleanup/ICleanupStore.js";
import type { DocReference } from "../../../ports/interfaces/docs/DocReference.js";
import type { IGitWorkspace } from "../../../ports/interfaces/git/IGitWorkspace.js";
import type { IPullRequestPublisher } from "../../../ports/interfaces/git/IPullRequestPublisher.js";
import type { IProgress } from "../../../ports/interfaces/progress/IProgress.js";
import { requireRun } from "../../helpers/cleanup/requireRun.js";
import type { FinishResult } from "../../interfaces/cleanup/FinishResult.js";
import type { SearchDocs } from "../docs/SearchDocs.js";
import type { SonarFixLoop } from "../quality/SonarFixLoop.js";
import { CleanupFolders } from "./CleanupFolders.js";

/**
 * Checks the whole branch against the baseline, writes the PR body, pushes the run's one branch and opens the pull
 * request (automode: the PR is the review). After a failed push or PR, running it again retries from the push.
 */
export class FinishCleanup {
  constructor(
    private readonly folders: CleanupFolders,
    private readonly store: ICleanupStore,
    private readonly gates: ICleanupGateFactory,
    private readonly writer: ICleanupReportWriter,
    private readonly fixLoop: SonarFixLoop,
    private readonly git: IGitWorkspace,
    private readonly publisher: IPullRequestPublisher,
    private readonly searchDocs: SearchDocs,
    private readonly progress: IProgress,
  ) {}

  async execute(runId: string): Promise<FinishResult> {
    const run = requireRun(this.store, runId);
    run.requireState("in-progress", "ready");
    // The branch the run started from may be gone by now; the PR then goes into the remote's default branch.
    const existing = run.pullRequest;
    const base = existing ? { base: run.baseBranch } : await this.git.resolveBase(run.workspace, run.baseBranch);
    if (base.note) this.progress.emit("base branch", "info", base.note);
    if (base.base !== run.baseBranch) {
      run.retarget(base.base);
      this.store.saveRun(run);
    }
    const prepared = run.state === "in-progress" ? await this.prepare(run) : undefined;
    const note = [base.note, prepared].filter(Boolean).join("\n");

    const reportPath = this.folders.report(run.id);
    this.progress.emit("push", "started", run.branch);
    await this.git.push(run.workspace, run.branch);
    this.progress.emit("push", "done", run.branch);
    // After a CI fix the PR is already open: the push alone updates it.
    let pullRequest = existing;
    if (!pullRequest) {
      this.progress.emit("pull request", "started", `into ${run.baseBranch}`);
      pullRequest = await this.publisher.open(run.workspace, run.branch, run.baseBranch,
        `Clean-up of ${run.repository}`, reportPath);
    }
    run.published(pullRequest);
    this.store.saveRun(run);
    this.progress.emit("pull request", "done", pullRequest);
    return { reportPath, pullRequest, ...(note ? { note } : {}) };
  }

  /** Validates the branch and writes the PR body; the run is then ready to push. */
  private async prepare(run: CleanupRun): Promise<string | undefined> {
    const batches = this.store.batches(run.id);
    const unfinished = batches.filter((b) => !b.isFinished);
    if (unfinished.length) {
      throw new DomainError(`Batches ${unfinished.map((b) => `${b.number} (${b.status})`).join(", ")} are not finished.`);
    }
    // Every blocking issue is either fixed, or the engineer escalated its batch and it has an issue.
    const escalated = new Set(batches.filter((b) => b.status === "escalated").flatMap((b) => b.findings.map(findingKey)));
    const open = run.reference.findings
      .filter((f) => isSonar(f) && isRequired(f, run.level) && !escalated.has(findingKey(f)));
    if (open.length) {
      throw new DomainError(`${open.length} SonarQube issues at level ${run.level} are still open and not escalated: ` +
        `${open.slice(0, 5).map((f) => `${f.rule} ${f.file}${f.line ? `:${f.line}` : ""}`).join(", ")}` +
        `${open.length > 5 ? ", …" : ""}. Add their category to config/cleanup.yaml and analyze again, or fix them.`);
    }
    if (!batches.some((b) => b.commitSha)) throw new DomainError("No batch was committed, so there is nothing to push.");

    const fewerTestsApproved = batches.some((b) => b.commitSha && b.gates.some((g) => g.gate === "tests"));
    const problems = ValidPr.problems(run.baseline, run.reference, { fewerTestsApproved });
    if (problems.length) throw new DomainError(`Not a valid PR: ${problems.join("; ")}`);

    const reportPath = this.folders.report(run.id);
    const gates = this.gates.forRun(run.id);
    writeFileSync(reportPath, this.writer.report(run, batches, this.docReferences(run), gates.sonarProject), "utf8");
    this.progress.emit("report", "done", reportPath);
    // Findings below the run's level stay in its SonarQube project, which the PR points to.
    const left = run.leftForLater.length;
    const note = left
      ? `Kept the SonarQube project${gates.sonarProject ? ` ${gates.sonarProject}` : ""}: ${left} findings below level ${run.level} are left in it.`
      : await gates.release();
    run.moveTo("ready");
    this.store.saveRun(run);
    return note;
  }

  /** For every security rule, the best matching section of the pulled official docs, if there is one. */
  private docReferences(run: CleanupRun): Map<string, DocReference> {
    const references = new Map<string, DocReference>();
    for (const f of run.baseline.findings.filter(isSecurityFinding)) {
      if (references.has(f.rule)) continue;
      const top = this.searchDocs.execute(`${f.rule} ${f.message}`.slice(0, 300))[0];
      if (top) references.set(f.rule, { heading: top.heading, url: top.url });
    }
    return references;
  }
}
