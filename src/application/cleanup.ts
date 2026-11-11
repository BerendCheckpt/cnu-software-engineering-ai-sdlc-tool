import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CleanupBatch, CleanupRun, findingKey, isRequired, isSecurityFinding, ValidPr, type CleanupLevel, type Finding,
  type GateSnapshot, type Snapshot,
} from "../domain/cleanup.js";
import { isSonar } from "../domain/quality.js";
import type { CleanupPlanner } from "../domain/cleanupPlanner.js";
import type { DiffClassifier } from "../domain/diffClassifier.js";
import { DomainError } from "../domain/errors.js";
import type { EvaluationResult } from "../domain/evaluation.js";
import { PathGuard } from "../domain/pathGuard.js";
import { timeStamp } from "../domain/progress.js";
import type {
  DocReference, ICleanupGateFactory, ICleanupReportWriter, IDependencyRestorer, IFormatter, IGitWorkspace, IProgress,
  IPullRequestPublisher, IRepoMirror, ISandbox,
} from "../ports/services.js";
import type { ICleanupStore } from "../ports/stores.js";
import type { SearchDocs } from "./docs.js";
import { runGates } from "./evaluation.js";
import { withCode, type FindingWithCode } from "./snippets.js";
import type { SonarFixLoop } from "./sonarFixLoop.js";

export type { FindingWithCode } from "./snippets.js";

/** Where one run keeps its files: `work/cleanup/<runId>/` with the checkout in `repo/`. */
export class CleanupFolders {
  private readonly root: PathGuard;

  constructor(workRoot: string) {
    this.root = new PathGuard(path.join(workRoot, "cleanup"));
  }

  run(runId: string): string { return this.root.resolve(runId); }
  workspace(runId: string): string { return path.join(this.run(runId), "repo"); }
  plan(runId: string): string { return path.join(this.run(runId), "plan.md"); }
  report(runId: string): string { return path.join(this.run(runId), "report.md"); }
}

/** Restores packages, runs every gate in parallel, then collects findings. No model involved. */
export class MeasureWorkspace {
  constructor(
    private readonly restorer: IDependencyRestorer,
    private readonly gates: ICleanupGateFactory,
    private readonly progress: IProgress,
  ) {}

  async execute(runId: string, workspace: string): Promise<Snapshot> {
    mkdirSync(path.join(workspace, ".aisdlc"), { recursive: true });
    this.progress.emit("restore packages", "started");
    await this.restorer.restore(workspace);
    this.progress.emit("restore packages", "done");
    const { evaluators, findingSources } = this.gates.forRun(runId);
    // Findings are read after the gates, because the SonarQube issues come from the scan the gates just ran.
    this.progress.emit("gates", "started", evaluators.map((e) => e.kind).join(", ") || "none");
    const results = await runGates(evaluators, workspace);
    for (const r of results) {
      this.progress.emit(`gate ${r.kind}`, r.isSkipped ? "info" : r.passed ? "done" : "failed", r.isSkipped ? "skipped" : r.digest);
    }
    this.progress.emit("findings", "started", findingSources.map((s) => s.name).join(", ") || "none");
    const findings = await Promise.all(findingSources.map(async (source) => {
      try {
        return await source.collect(workspace);
      } catch (error) {
        // A source that silently returned nothing would make every finding look fixed.
        throw new Error(`${source.name}: ${(error as Error).message}`);
      }
    }));
    const limitations = findingSources.flatMap((s) => s.limitations?.() ?? []);
    this.progress.emit("findings", "done", `${findings.flat().length} open`);
    return { gates: results.map(toGateSnapshot), findings: findings.flat(), ...(limitations.length ? { limitations } : {}) };
  }
}

function toGateSnapshot(r: EvaluationResult): GateSnapshot {
  return {
    kind: r.kind,
    passed: r.passed,
    skipped: r.isSkipped,
    ...(r.metrics.tests ? { tests: r.metrics.tests } : {}),
    ...(r.metrics.coverage !== undefined ? { coverage: r.metrics.coverage } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------

export interface AnalysisResult {
  run: CleanupRun;
  batches: CleanupBatch[];
  planPath: string;
}

/** A new run id: it names the workspace, the session and the SonarQube project. */
export function newRunId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Copies a mirror into a workspace on the run's one branch, `cleanup/DD-MM-YYYY-HHmmss`, measures it and writes the plan.
 * The plan starts right away (automode): the pull request is where a human reviews the result.
 */
export class AnalyzeRepository {
  constructor(
    private readonly folders: CleanupFolders,
    private readonly store: ICleanupStore,
    private readonly mirror: IRepoMirror,
    private readonly git: IGitWorkspace,
    private readonly sandbox: ISandbox,
    private readonly measure: MeasureWorkspace,
    private readonly planner: CleanupPlanner,
    private readonly writer: ICleanupReportWriter,
    private readonly progress: IProgress,
  ) {}

  /** `level` picks the SonarQube severities to fix; findings below it are not planned. */
  async execute(repository: string, id = newRunId(), now = new Date(), level: CleanupLevel = "verbose"): Promise<AnalysisResult> {
    if (!this.mirror.exists(repository)) {
      throw new DomainError(`No mirror or linked folder ${repository}. Link a folder you pulled with: repo link <folder>, ` +
        "or request a clone with: repo add <https-url>");
    }
    const branch = `cleanup/${timeStamp(now)}`;
    const earlier = this.store.runOnBranch(repository, branch);
    if (earlier) {
      throw new DomainError(`Clean-up ${earlier.id} already ran on ${repository} as branch ${branch}: ` +
        "a clean-up or migration already took place on this data.");
    }
    await this.sandbox.ensureAvailable();

    this.progress.emit("checkout", "started", repository);
    const workspace = this.folders.workspace(id);
    await this.mirror.checkout(repository, workspace);
    const { baseBranch, note } = await this.git.prepare(workspace, branch);
    this.progress.emit("checkout", "done", `${branch} from ${baseBranch}`);
    if (note) this.progress.emit("checkout", "info", note);
    const measured = await this.measure.execute(id, workspace);
    const baseline = note ? { ...measured, limitations: [...measured.limitations ?? [], note] } : measured;

    const run = CleanupRun.start({ id, repository, workspace, branch, baseBranch, baseline, level });
    run.moveTo("accepted");
    const batches = this.planner.plan(id, baseline.findings.filter((f) => isRequired(f, level)));
    this.store.saveRun(run);
    for (const batch of batches) this.store.saveBatch(batch);
    const planPath = this.folders.plan(id);
    writeFileSync(planPath, this.writer.plan(run, batches), "utf8");
    this.progress.emit("plan", "done", `${batches.length} batches, ${baseline.findings.length} findings`);
    return { run, batches, planPath };
  }
}

// ---------------------------------------------------------------------------------------------------------------

export type NextStep =
  | { kind: "work"; run: CleanupRun; batch: CleanupBatch; findings: FindingWithCode[] }
  | { kind: "formatted"; run: CleanupRun; batch: CleanupBatch; applied: string[] }
  /** A batch failed its last try; nothing goes on until the engineer retries or escalates it. */
  | { kind: "waiting"; run: CleanupRun; batch: CleanupBatch }
  | { kind: "finished"; run: CleanupRun };

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

// ---------------------------------------------------------------------------------------------------------------

export type CheckOutcome =
  | { kind: "committed"; batch: CleanupBatch; fixed: number }
  | { kind: "nothing-changed"; batch: CleanupBatch }
  /** Not committed: something got worse, or a finding of the batch is still open. */
  | { kind: "regression"; batch: CleanupBatch; problems: string[]; open: FindingWithCode[]; tries: number; maxTries: number }
  /** The last allowed try failed: the batch keeps its change and waits for the engineer to retry or escalate it. */
  | { kind: "waiting"; batch: CleanupBatch; problems: string[]; open: FindingWithCode[]; tries: number };

/** `cleanup:<runId>#<batch>`: the fix loop of one batch. */
export function batchSubject(batch: CleanupBatch): string {
  return `cleanup:${batch.runId}#${batch.number}`;
}

/** The batch's own findings that the measurement still reports. */
function stillOpen(findings: Finding[], current: Snapshot): Finding[] {
  const open = new Set(current.findings.map(findingKey));
  return findings.filter((f) => open.has(findingKey(f)));
}

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
    const loop = this.fixLoop.checkBatch(batchSubject(batch), { blocking: open, reported: [], problems }, this.maxTries);
    if (loop.kind !== "clean") {
      const summary = [...problems, ...open.map((f) => `${f.rule} still open`)].slice(0, 3).join("; ");
      if (loop.kind === "engineer") {
        batch.waitForEngineer();
        this.store.saveBatch(batch);
        this.progress.emit(step, "failed", `try ${loop.tries} of ${loop.maxTries}, waiting for the engineer: ${summary}`);
        return { kind: "waiting", batch, problems, open: withCode(run.workspace, open), tries: loop.tries };
      }
      batch.recordFailedCheck();
      this.store.saveBatch(batch);
      this.progress.emit(step, "failed", `try ${loop.tries} of ${loop.maxTries}: ${summary}`);
      return {
        kind: "regression", batch, problems, open: withCode(run.workspace, open), tries: loop.tries, maxTries: loop.maxTries,
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

export interface EscalationOutcome {
  batch: CleanupBatch;
  /** True when the batch's change made nothing worse and was committed with the findings it did fix. */
  committed: boolean;
  /** Why the change was not committed. */
  problems: string[];
  /** One link per finding left, or where its issue text is when the issue could not be opened. */
  issues: string[];
}

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
        left = stillOpen(batch.findings, current);
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

/** What to tell the caller while a batch waits: only the engineer may choose. */
export function waitingMessage(runId: string, batch: CleanupBatch): string {
  return `Batch ${batch.number} still has findings open after its last try and waits for the engineer. Ask them to ` +
    `choose: retry it (aisdlc cleanup retry ${runId}), or a PR with an issue per finding left ` +
    `(aisdlc cleanup escalate ${runId}).`;
}

// ---------------------------------------------------------------------------------------------------------------

export interface FinishResult {
  reportPath: string;
  pullRequest: string;
  note?: string;
}

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
    const note = run.state === "in-progress" ? await this.prepare(run) : undefined;

    const reportPath = this.folders.report(run.id);
    this.progress.emit("push", "started", run.branch);
    await this.git.push(run.workspace, run.branch);
    this.progress.emit("push", "done", run.branch);
    this.progress.emit("pull request", "started", `into ${run.baseBranch}`);
    const pullRequest = await this.publisher.open(run.workspace, run.branch, run.baseBranch,
      `Clean-up of ${run.repository}`, reportPath);
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

export class CleanupStatus {
  constructor(private readonly store: ICleanupStore) {}

  execute(runId: string): { run: CleanupRun; batches: CleanupBatch[] } {
    return { run: requireRun(this.store, runId), batches: this.store.batches(runId) };
  }
}

function requireRun(store: ICleanupStore, id: string): CleanupRun {
  const run = store.run(id);
  if (!run) throw new DomainError(`No clean-up ${id}.`);
  return run;
}

function sonarLink(url: string | undefined): { sonarProjectUrl?: string } {
  return url ? { sonarProjectUrl: url } : {};
}

function commitMessage(batch: CleanupBatch, fixed: number): string {
  if (batch.category === "format") return "Clean-up: apply the repository's formatters";
  const rules = [...new Set(batch.findings.map((f) => f.rule))].slice(0, 5).join(", ");
  return `Clean-up batch ${batch.number} (${batch.category}): ${fixed} ${fixed === 1 ? "finding" : "findings"} fixed\n\nRules: ${rules}`;
}
