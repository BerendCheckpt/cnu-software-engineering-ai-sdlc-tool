import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Finding } from "../domain/cleanup.js";
import { DomainError } from "../domain/errors.js";
import { EvaluationResult } from "../domain/evaluation.js";
import { PathGuard } from "../domain/pathGuard.js";
import type { Solution } from "../domain/solution.js";
import type {
  IDependencyRestorer, IEvaluator, IFindingSource, IReportWriter, IRepoMirror, ISandbox,
} from "../ports/services.js";
import type { IFixLoopStore, ISolutionStore } from "../ports/stores.js";
import { withCode, type FindingWithCode } from "./snippets.js";
import type { LoopOutcome, SonarFixLoop } from "./sonarFixLoop.js";

/** A writable copy of a mirrored repository with the solution's diff applied: `work/<solutionId>`. */
export class PrepareWorkspace {
  private readonly work: PathGuard;

  constructor(
    workRoot: string,
    private readonly store: ISolutionStore,
    private readonly mirror: IRepoMirror,
  ) {
    this.work = new PathGuard(workRoot);
  }

  async execute(solutionId: string, repository: string): Promise<string> {
    const solution = requireSolution(this.store, solutionId);
    const workspace = this.work.resolve(solution.id);
    await this.mirror.checkout(repository, workspace);
    if (solution.diff.trim()) await this.mirror.applyPatch(workspace, solution.diff);
    return workspace;
  }
}

/** Where the gates run: the sandbox must be there, and packages are restored before any gate starts. */
export interface GateEnvironment {
  sandbox: ISandbox;
  restorer: IDependencyRestorer;
}

/** The gates of one solution and the source of its SonarQube issues. */
export interface SolutionGates {
  evaluators: IEvaluator[];
  findingSources: IFindingSource[];
  sonarProjectUrl?: string;
}

/** What `eval` found, and what the model has to do next. */
export interface EvaluationOutcome {
  results: EvaluationResult[];
  /** `not-checked`: no gate ran, or the solution is no longer a draft, so there is nothing to fix or count. */
  loop: LoopOutcome | { kind: "not-checked" };
  blocking: FindingWithCode[];
  reported: FindingWithCode[];
  /** Gates that failed and SonarQube issues that could not be read. */
  problems: string[];
  limitations: string[];
}

/**
 * Runs every gate in parallel and keeps a short digest of each, then reads the solution's open SonarQube issues.
 * A draft becomes `evaluated` only when every gate that ran passed and no blocking issue is open. Otherwise the
 * model gets the issues to fix, and after too many failed checks the solution goes to a human (ADR 0010). The
 * gates are made per solution, because each solution is scanned into its own SonarQube project.
 */
export class RunEvaluations {
  private readonly work: PathGuard;

  constructor(
    workRoot: string,
    private readonly store: ISolutionStore,
    private readonly gatesFor: (solutionId: string) => SolutionGates,
    private readonly environment: GateEnvironment,
    private readonly fixLoop: SonarFixLoop,
    private readonly mirror: IRepoMirror,
  ) {
    this.work = new PathGuard(workRoot);
  }

  async execute(solutionId: string, repository: string): Promise<EvaluationOutcome> {
    const solution = requireSolution(this.store, solutionId);
    if (solution.state === "escalated") {
      const where = this.fixLoop.current(subjectOf(solution.id))?.escalation ?? "see the work folder";
      throw new DomainError(`Solution ${solution.id} was escalated to a human (${where}). ` +
        `Stop here; a human hands it back with: aisdlc reopen ${solution.id}`);
    }
    const workspace = this.work.resolve(solution.id);
    await this.environment.sandbox.ensureAvailable();
    mkdirSync(path.join(workspace, ".aisdlc"), { recursive: true });
    await this.environment.restorer.restore(workspace);
    const gates = this.gatesFor(solution.id);
    const results = await runGates(gates.evaluators, workspace);
    // Read after the gates: the issues come from the scan the gates just ran.
    const sonar = gates.findingSources.filter((s) => s.name.toLowerCase() === "sonar");
    const problems = results.filter((r) => !r.isSkipped && !r.passed).map((r) => `${r.kind} failed: ${r.digest}`);
    const findings: Finding[] = [];
    for (const source of sonar) {
      try {
        findings.push(...await source.collect(workspace));
      } catch (error) {
        // Missing issues would look fixed, so a read that failed is a failed check.
        problems.push(`SonarQube issues could not be read: ${(error as Error).message}`);
      }
    }
    const limitations = sonar.flatMap((s) => s.limitations?.() ?? []);

    for (const result of results) {
      try {
        this.store.saveEvaluation(solution.id, result);
      } catch (error) {
        console.error(`The ${result.kind} result of ${solution.id} was not saved: ${(error as Error).message}`);
      }
    }

    const { blocking, reported } = this.fixLoop.split(findings);
    const ran = results.some((r) => !r.isSkipped);
    let loop: EvaluationOutcome["loop"] = { kind: "not-checked" };
    if (solution.state === "draft" && ran) {
      loop = await this.fixLoop.check(subjectOf(solution.id), { blocking, reported, problems }, async () => ({
        task: `solution ${solution.id}: ${solution.summary}`,
        details: [`Request: ${solution.prompt}`, `Evaluated in a copy of the mirror with the solution's diff applied.`],
        repository,
        remoteUrl: await this.mirror.remoteUrl(repository).catch(() => undefined),
        location: [`Workspace: ${workspace}`, "Nothing was committed or pushed: the change is the diff below."],
        ...(gates.sonarProjectUrl ? { sonarProjectUrl: gates.sonarProjectUrl } : {}),
        diff: solution.diff,
        reproduce: `aisdlc eval ${solution.id} --repo ${repository}`,
        limitations,
      }));
      if (loop.kind === "clean") solution.moveTo("evaluated");
      if (loop.kind === "escalated") solution.moveTo("escalated");
      if (loop.kind !== "fix-required") this.store.save(solution);
    }
    return { results, loop, blocking: withCode(workspace, blocking), reported: withCode(workspace, reported), problems, limitations };
  }
}

export function subjectOf(solutionId: string): string {
  return `solution:${solutionId}`;
}

/** Runs every gate in parallel. One broken gate must not hide the others' results, so an error becomes a failure. */
export function runGates(evaluators: IEvaluator[], workspace: string): Promise<EvaluationResult[]> {
  return Promise.all(evaluators.map(async (evaluator) => {
    try {
      return await evaluator.evaluate(workspace);
    } catch (error) {
      return new EvaluationResult(evaluator.kind, false, `error: ${(error as Error).message}`);
    }
  }));
}

/** Writes the combined report that goes into the pull request: `work/<solutionId>/report.md`. */
export class WriteReport {
  private readonly work: PathGuard;

  constructor(
    workRoot: string,
    private readonly store: ISolutionStore,
    private readonly writer: IReportWriter,
    private readonly fixLoops?: IFixLoopStore,
  ) {
    this.work = new PathGuard(workRoot);
  }

  execute(solutionId: string, summary?: string): { path: string; markdown: string } {
    const solution = requireSolution(this.store, solutionId);
    const last = this.fixLoops?.get(subjectOf(solution.id))?.last;
    const markdown = this.writer.render(solution, this.latestPerKind(solution.id), summary,
      last ? [...last.blocking, ...last.reported] : undefined);
    const file = path.join(this.work.resolve(solution.id), "report.md");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, markdown, "utf8");
    return { path: file, markdown };
  }

  private latestPerKind(solutionId: string): EvaluationResult[] {
    const latest = new Map<string, EvaluationResult>();
    for (const result of this.store.evaluations(solutionId)) latest.set(result.kind, result);
    return [...latest.values()];
  }
}

/** Prepares the workspace when needed, runs every gate and writes the PR report. */
export class EvaluateSolution {
  constructor(
    private readonly workRoot: string,
    private readonly prepare: PrepareWorkspace,
    private readonly run: RunEvaluations,
    private readonly report: WriteReport,
  ) {}

  async execute(solutionId: string, repository: string): Promise<EvaluationOutcome & { reportPath: string }> {
    if (!existsSync(new PathGuard(this.workRoot).resolve(solutionId))) await this.prepare.execute(solutionId, repository);
    const outcome = await this.run.execute(solutionId, repository);
    return { ...outcome, reportPath: this.report.execute(solutionId).path };
  }
}

/** A draft gets a new diff, for example the fix after a failed check. The next `eval` starts from a fresh copy. */
export class ReviseSolution {
  private readonly work: PathGuard;

  constructor(workRoot: string, private readonly store: ISolutionStore) {
    this.work = new PathGuard(workRoot);
  }

  execute(solutionId: string, diff: string, summary?: string): Solution {
    const solution = requireSolution(this.store, solutionId);
    solution.revise(diff, summary);
    this.store.save(solution);
    rmSync(this.work.resolve(solution.id), { recursive: true, force: true });
    return solution;
  }
}

/** A human hands an escalated solution back as a draft; its fix attempts count from zero again. */
export class ReopenSolution {
  constructor(private readonly store: ISolutionStore, private readonly fixLoop: SonarFixLoop) {}

  execute(solutionId: string): Solution {
    const solution = requireSolution(this.store, solutionId);
    solution.moveTo("draft");
    this.fixLoop.reopen(subjectOf(solution.id));
    this.store.save(solution);
    return solution;
  }
}

function requireSolution(store: ISolutionStore, id: string): Solution {
  const solution = store.get(id);
  if (!solution) throw new DomainError(`No solution ${id}.`);
  return solution;
}
