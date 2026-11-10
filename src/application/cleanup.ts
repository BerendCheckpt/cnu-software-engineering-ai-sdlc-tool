import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CleanupBatch, CleanupRun, findingKey, isSecurityFinding, ValidPr, type GateSnapshot, type Snapshot,
} from "../domain/cleanup.js";
import type { CleanupPlanner } from "../domain/cleanupPlanner.js";
import type { DiffClassifier } from "../domain/diffClassifier.js";
import { DomainError } from "../domain/errors.js";
import type { EvaluationResult } from "../domain/evaluation.js";
import { PathGuard } from "../domain/pathGuard.js";
import { dayStamp } from "../domain/progress.js";
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
 * Copies a mirror into a workspace on the run's one branch, `cleanup/DD-MM-YYYY`, measures it and writes the plan.
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

  async execute(repository: string, id = newRunId(), now = new Date()): Promise<AnalysisResult> {
    if (!this.mirror.exists(repository)) {
      throw new DomainError(`No mirror or linked folder ${repository}. Link a folder you pulled with: repo link <folder>, ` +
        "or request a clone with: repo add <https-url>");
    }
    const branch = `cleanup/${dayStamp(now)}`;
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

    const run = CleanupRun.start({ id, repository, workspace, branch, baseBranch, baseline });
    run.moveTo("accepted");
    const batches = this.planner.plan(id, baseline.findings);
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
  /** Not committed: something got worse, or a blocking SonarQube issue of the batch is still open. */
  | {
    kind: "regression"; batch: CleanupBatch; problems: string[]; open: FindingWithCode[];
    failures: number; maxFixAttempts: number;
  }
  | { kind: "escalated"; batch: CleanupBatch; where: string };

/** `cleanup:<runId>#<batch>`: the fix loop of one batch. */
export function batchSubject(batch: CleanupBatch): string {
  return `cleanup:${batch.runId}#${batch.number}`;
}

/**
 * Measures the open batch and decides what happens to it: committed, sent back to the model, or escalated to a
 * human after too many failed checks (ADR 0010). A diff that touches tests, dependencies or security-sensitive code
 * is committed too, with what it touched kept on the batch, so the PR flags it for the reviewer.
 */
export class CheckBatch {
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

  async execute(runId: string): Promise<CheckOutcome> {
    const run = requireRun(this.store, runId);
    run.requireState("in-progress");
    const batch = this.store.batches(runId).find((b) => b.isOpen);
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
    // The batch's own blocking issues must be gone; new ones are already a problem above.
    const stillOpen = new Set(current.findings.map(findingKey));
    const open = this.fixLoop.policy.blocking(batch.findings).filter((f) => stillOpen.has(findingKey(f)));
    const loop = await this.fixLoop.check(batchSubject(batch),
      { blocking: open, reported: this.fixLoop.policy.reported(batch.findings), problems },
      async () => ({
        task: `clean-up ${run.id}, batch ${batch.number} (${batch.category}) of ${run.repository}`,
        details: batch.findings.slice(0, 10).map((f) => `${f.severity} ${f.rule} \`${f.file}${f.line ? `:${f.line}` : ""}\`: ${f.message}`),
        repository: run.repository,
        remoteUrl: await this.mirror.remoteUrl(run.repository).catch(() => undefined),
        location: [
          `Branch: ${run.branch}, local only and not pushed, from ${run.baseBranch}`,
          `The batch started at commit ${batch.baseSha}; its change was reset and is in the diff below.`,
          `Workspace: ${run.workspace}`,
        ],
        ...sonarLink(this.gates.forRun(run.id).sonarProjectUrl),
        diff,
        reproduce: `aisdlc cleanup check ${run.id}`,
        limitations: current.limitations ?? [],
      }));
    if (loop.kind === "escalated") {
      await this.git.resetTo(run.workspace, batch.baseSha);
      batch.escalate(loop.where);
      this.store.saveBatch(batch);
      this.progress.emit(step, "failed", `escalated: ${loop.where}`);
      return { kind: "escalated", batch, where: loop.where };
    }
    if (loop.kind === "fix-required") {
      batch.recordFailedCheck();
      this.store.saveBatch(batch);
      this.progress.emit(step, "failed", `attempt ${loop.failures} of ${loop.maxFixAttempts}: ` +
        [...problems, ...open.map((f) => `${f.rule} still open`)].slice(0, 3).join("; "));
      return {
        kind: "regression", batch, problems, open: withCode(run.workspace, open),
        failures: loop.failures, maxFixAttempts: loop.maxFixAttempts,
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

/** Gives up on the open batch: its changes are thrown away and the reason is kept for the report. */
export class SkipBatch {
  constructor(
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
    private readonly fixLoop: SonarFixLoop,
    private readonly progress: IProgress,
  ) {}

  async execute(runId: string, reason: string): Promise<CleanupBatch> {
    const run = requireRun(this.store, runId);
    const batch = this.store.batches(runId).find((b) => b.isOpen);
    if (!batch?.baseSha) throw new DomainError("No batch is open.");
    const blocking = this.fixLoop.policy.blocking(batch.findings);
    if (blocking.length) {
      throw new DomainError(`Batch ${batch.number} has ${blocking.length} blocking SonarQube issues, so it cannot be ` +
        `skipped. Fix them and run: aisdlc cleanup check ${run.id}. After too many failed checks it goes to a human.`);
    }
    batch.skip(reason);
    await this.git.resetTo(run.workspace, batch.baseSha);
    this.store.saveBatch(batch);
    this.progress.emit(`batch ${batch.number}`, "info", `skipped: ${reason}`);
    return batch;
  }
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
    // Every blocking issue is either fixed, or a human has it in an escalation issue.
    const escalated = new Set(batches.filter((b) => b.status === "escalated").flatMap((b) => b.findings.map(findingKey)));
    const open = this.fixLoop.policy.blocking(run.reference.findings).filter((f) => !escalated.has(findingKey(f)));
    if (open.length) {
      throw new DomainError(`${open.length} blocking SonarQube issues are still open and not escalated: ` +
        `${open.slice(0, 5).map((f) => `${f.rule} ${f.file}${f.line ? `:${f.line}` : ""}`).join(", ")}` +
        `${open.length > 5 ? ", …" : ""}. Add their category to config/cleanup.yaml and analyze again, or fix them.`);
    }
    if (!batches.some((b) => b.commitSha)) throw new DomainError("No batch was committed, so there is nothing to push.");

    const fewerTestsApproved = batches.some((b) => b.status === "done" && b.gates.some((g) => g.gate === "tests"));
    const problems = ValidPr.problems(run.baseline, run.reference, { fewerTestsApproved });
    if (problems.length) throw new DomainError(`Not a valid PR: ${problems.join("; ")}`);

    const reportPath = this.folders.report(run.id);
    writeFileSync(reportPath, this.writer.report(run, batches, this.docReferences(run)), "utf8");
    this.progress.emit("report", "done", reportPath);
    const note = await this.gates.forRun(run.id).release();
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
