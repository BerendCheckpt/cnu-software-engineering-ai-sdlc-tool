import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Approval } from "../domain/approval.js";
import {
  CleanupBatch, CleanupRun, findingKey, ValidPr, type GateHit, type GateSnapshot, type Snapshot,
} from "../domain/cleanup.js";
import type { CleanupPlanner } from "../domain/cleanupPlanner.js";
import type { DiffClassifier } from "../domain/diffClassifier.js";
import { DomainError } from "../domain/errors.js";
import type { EvaluationResult } from "../domain/evaluation.js";
import { PathGuard } from "../domain/pathGuard.js";
import type {
  ICleanupGateFactory, ICleanupReportWriter, IDependencyRestorer, IFormatter, IGitWorkspace, IPullRequestPublisher,
  IRepoMirror, ISandbox,
} from "../ports/services.js";
import type { IApprovalStore, ICleanupStore } from "../ports/stores.js";
import type { RequestApproval } from "./approvals.js";
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
  constructor(private readonly restorer: IDependencyRestorer, private readonly gates: ICleanupGateFactory) {}

  async execute(runId: string, workspace: string): Promise<Snapshot> {
    mkdirSync(path.join(workspace, ".aisdlc"), { recursive: true });
    await this.restorer.restore(workspace);
    const { evaluators, findingSources } = this.gates.forRun(runId);
    // Findings are read after the gates, because the SonarQube issues come from the scan the gates just ran.
    const results = await runGates(evaluators, workspace);
    const findings = await Promise.all(findingSources.map(async (source) => {
      try {
        return await source.collect(workspace);
      } catch (error) {
        // A source that silently returned nothing would make every finding look fixed.
        throw new Error(`${source.name}: ${(error as Error).message}`);
      }
    }));
    const limitations = findingSources.flatMap((s) => s.limitations?.() ?? []);
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
  approval: Approval;
}

/** Copies a mirror into a workspace, measures it and writes a plan that waits for a human. */
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
    private readonly requestApproval: RequestApproval,
  ) {}

  async execute(repository: string): Promise<AnalysisResult> {
    if (!this.mirror.exists(repository)) {
      throw new DomainError(`No mirror or linked folder ${repository}. Link a folder you pulled with: repo link <folder>, ` +
        "or request a clone with: repo add <https-url>");
    }
    await this.sandbox.ensureAvailable();

    const id = randomBytes(4).toString("hex");
    const workspace = this.folders.workspace(id);
    await this.mirror.checkout(repository, workspace);
    const branch = `aisdlc/cleanup-${id}`;
    const { baseBranch } = await this.git.prepare(workspace, branch);
    const baseline = await this.measure.execute(id, workspace);

    const run = CleanupRun.start({ id, repository, workspace, branch, baseBranch, baseline });
    const batches = this.planner.plan(id, baseline.findings);
    const approval = this.requestApproval.execute("cleanup-plan", id,
      `clean up ${repository}: ${batches.length} batches, ${baseline.findings.length} findings`);
    run.awaitPlanApproval(approval.id);

    this.store.saveRun(run);
    for (const batch of batches) this.store.saveBatch(batch);
    const planPath = this.folders.plan(id);
    writeFileSync(planPath, this.writer.plan(run, batches), "utf8");
    return { run, batches, planPath, approval };
  }
}

/** What happens to a plan once a human decided on it. Called by the CLI's approve and deny, never by a model. */
export class DecideCleanupPlan {
  constructor(private readonly approvals: IApprovalStore, private readonly store: ICleanupStore) {}

  accepted(approval: Approval): CleanupRun {
    approval.ensureApprovedFor("cleanup-plan");
    const run = requireRun(this.store, approval.target);
    run.moveTo("accepted");
    approval.consume("cleanup-plan");
    this.store.saveRun(run);
    this.approvals.save(approval);
    return run;
  }

  denied(approval: Approval): CleanupRun {
    const run = requireRun(this.store, approval.target);
    run.moveTo("abandoned");
    this.store.saveRun(run);
    return run;
  }
}

// ---------------------------------------------------------------------------------------------------------------

export type NextStep =
  | { kind: "work"; run: CleanupRun; batch: CleanupBatch; findings: FindingWithCode[] }
  | { kind: "formatted"; run: CleanupRun; batch: CleanupBatch; applied: string[] }
  | { kind: "waiting"; run: CleanupRun; batch: CleanupBatch }
  | { kind: "finished"; run: CleanupRun };

/** Starts the next batch, or returns the one still open. The formatting batch runs its tools here, without a model. */
export class NextBatch {
  constructor(
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
    private readonly formatters: IFormatter[],
  ) {}

  async execute(runId: string): Promise<NextStep> {
    const run = requireRun(this.store, runId);
    run.requireState("accepted", "in-progress");
    const batches = this.store.batches(runId);

    const open = batches.find((b) => b.isOpen);
    if (open) return open.status === "awaiting-approval" ? { kind: "waiting", run, batch: open } : this.work(run, open);

    const next = batches.find((b) => b.status === "pending");
    if (!next) return { kind: "finished", run };
    next.start(await this.git.head(run.workspace));
    run.moveTo("in-progress");
    this.store.saveBatch(next);
    this.store.saveRun(run);

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
  | { kind: "escalated"; batch: CleanupBatch; where: string }
  | { kind: "awaiting-approval"; batch: CleanupBatch; gates: GateHit[]; approval: Approval };

/** `cleanup:<runId>#<batch>`: the fix loop of one batch. */
export function batchSubject(batch: CleanupBatch): string {
  return `cleanup:${batch.runId}#${batch.number}`;
}

/**
 * Measures the open batch and decides what happens to it: committed, sent back to the model, escalated to a
 * human after too many failed checks (ADR 0010), or held for a human because the diff touches tests, dependencies
 * or security-sensitive code.
 */
export class CheckBatch {
  constructor(
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
    private readonly sandbox: ISandbox,
    private readonly measure: MeasureWorkspace,
    private readonly classifier: DiffClassifier,
    private readonly requestApproval: RequestApproval,
    private readonly fixLoop: SonarFixLoop,
    private readonly mirror: IRepoMirror,
    private readonly gates: ICleanupGateFactory,
  ) {}

  async execute(runId: string): Promise<CheckOutcome> {
    const run = requireRun(this.store, runId);
    run.requireState("in-progress");
    const batch = this.store.batches(runId).find((b) => b.isOpen);
    if (!batch?.baseSha) throw new DomainError("No batch is open. Start one with: cleanup next");

    const diff = await this.git.diffSince(run.workspace, batch.baseSha);
    if (!diff.trim()) {
      if (batch.category !== "format") return { kind: "nothing-changed", batch };
      batch.complete(undefined, []);
      this.store.saveBatch(batch);
      return { kind: "committed", batch, fixed: 0 };
    }

    await this.sandbox.ensureAvailable();
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
      return { kind: "escalated", batch, where: loop.where };
    }
    if (loop.kind === "fix-required") {
      batch.recordFailedCheck();
      this.store.saveBatch(batch);
      return {
        kind: "regression", batch, problems, open: withCode(run.workspace, open),
        failures: loop.failures, maxFixAttempts: loop.maxFixAttempts,
      };
    }

    if (gates.length) {
      const hash = diffHash(diff);
      // The hash is part of the target: an edited diff is a different change and needs its own approval.
      const approval = this.requestApproval.execute("cleanup-change", `${run.id}#${batch.number}@${hash.slice(0, 12)}`,
        `batch ${batch.number} (${batch.category}) changes ${gates.map((g) => `${g.gate}: ${g.files.join(", ")}`).join("; ")}`);
      batch.awaitApproval(gates, hash, approval.id, current);
      this.store.saveBatch(batch);
      return { kind: "awaiting-approval", batch, gates, approval };
    }

    const fixed = ValidPr.fixed(run.reference, current).length;
    batch.complete(await this.git.commit(run.workspace, commitMessage(batch, fixed)), []);
    run.acceptMeasurement(current);
    this.store.saveBatch(batch);
    this.store.saveRun(run);
    return { kind: "committed", batch, fixed };
  }
}

/** A human's decision on a gated batch. Called by the CLI's approve and deny, never by a model. */
export class DecideCleanupChange {
  constructor(
    private readonly approvals: IApprovalStore,
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
  ) {}

  async accepted(approval: Approval): Promise<CleanupBatch> {
    approval.ensureApprovedFor("cleanup-change");
    const { run, batch } = this.batchOf(approval);
    const diff = await this.git.diffSince(run.workspace, batch.baseSha!);
    if (diffHash(diff) !== batch.diffHash) {
      throw new DomainError(`Batch ${batch.number} changed after it was checked. Run cleanup check again; ` +
        "the new change needs its own approval.");
    }
    const fixed = ValidPr.fixed(run.reference, batch.candidate!).length;
    batch.complete(await this.git.commit(run.workspace, commitMessage(batch, fixed)));
    run.acceptMeasurement(batch.candidate!);
    approval.consume("cleanup-change");
    this.store.saveBatch(batch);
    this.store.saveRun(run);
    this.approvals.save(approval);
    return batch;
  }

  async denied(approval: Approval): Promise<CleanupBatch> {
    const { run, batch } = this.batchOf(approval);
    await this.git.resetTo(run.workspace, batch.baseSha!);
    batch.skip(`denied by ${approval.toProps().decidedBy ?? "a human"}`);
    this.store.saveBatch(batch);
    return batch;
  }

  private batchOf(approval: Approval): { run: CleanupRun; batch: CleanupBatch } {
    const target = /^([0-9a-f]+)#(\d+)@/.exec(approval.target);
    if (!target) throw new DomainError(`Approval ${approval.id} is not for a clean-up batch.`);
    const run = requireRun(this.store, target[1]!);
    const batch = this.store.batches(run.id).find((b) => b.number === Number(target[2]));
    if (!batch || batch.approvalId !== approval.id || batch.status !== "awaiting-approval") {
      throw new DomainError(`Batch ${target[2]} of ${run.id} is not waiting for approval ${approval.id}.`);
    }
    return { run, batch };
  }
}

/** Gives up on the open batch: its changes are thrown away and the reason is kept for the report. */
export class SkipBatch {
  constructor(
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
    private readonly fixLoop: SonarFixLoop,
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
    return batch;
  }
}

// ---------------------------------------------------------------------------------------------------------------

/** Checks the whole branch against the baseline, writes the PR body and asks a human for permission to push. */
export class FinishCleanup {
  constructor(
    private readonly folders: CleanupFolders,
    private readonly store: ICleanupStore,
    private readonly gates: ICleanupGateFactory,
    private readonly writer: ICleanupReportWriter,
    private readonly requestApproval: RequestApproval,
    private readonly fixLoop: SonarFixLoop,
  ) {}

  async execute(runId: string): Promise<{ reportPath: string; approval: Approval; note?: string }> {
    const run = requireRun(this.store, runId);
    run.requireState("in-progress");
    const batches = this.store.batches(runId);
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
    writeFileSync(reportPath, this.writer.report(run, batches), "utf8");
    const note = await this.gates.forRun(run.id).release();
    run.moveTo("ready");
    const approval = this.requestApproval.execute("push", run.id,
      `push ${run.branch} and open a pull request into ${run.baseBranch} of ${run.repository}`);
    this.store.saveRun(run);
    return { reportPath, approval, ...(note ? { note } : {}) };
  }
}

/** Pushes the branch and opens the PR, once, after a human approved it. A failure can be retried. */
export class PublishCleanup {
  constructor(
    private readonly folders: CleanupFolders,
    private readonly approvals: IApprovalStore,
    private readonly store: ICleanupStore,
    private readonly git: IGitWorkspace,
    private readonly publisher: IPullRequestPublisher,
  ) {}

  async execute(approval: Approval): Promise<string> {
    approval.ensureApprovedFor("push");
    const run = requireRun(this.store, approval.target);
    run.requireState("ready");
    await this.git.push(run.workspace, run.branch);
    const pullRequest = await this.publisher.open(run.workspace, run.branch, run.baseBranch,
      `Clean-up of ${run.repository}`, this.folders.report(run.id));
    approval.consume("push");
    run.published(pullRequest);
    this.store.saveRun(run);
    this.approvals.save(approval);
    return pullRequest;
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

function diffHash(diff: string): string {
  return createHash("sha256").update(diff).digest("hex");
}

function commitMessage(batch: CleanupBatch, fixed: number): string {
  if (batch.category === "format") return "Clean-up: apply the repository's formatters";
  const rules = [...new Set(batch.findings.map((f) => f.rule))].slice(0, 5).join(", ");
  return `Clean-up batch ${batch.number} (${batch.category}): ${fixed} ${fixed === 1 ? "finding" : "findings"} fixed\n\nRules: ${rules}`;
}
