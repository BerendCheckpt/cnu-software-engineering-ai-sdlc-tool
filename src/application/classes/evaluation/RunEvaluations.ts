import { mkdirSync } from "node:fs";
import path from "node:path";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { PathGuard } from "../../../domain/classes/security/PathGuard.js";
import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import type { IRepoMirror } from "../../../ports/interfaces/repository/IRepoMirror.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { AISDLC_DIR } from "../../../shared/constants/workspace/AISDLC_DIR.js";
import { errorMessage } from "../../../shared/helpers/errors/errorMessage.js";
import { runGates } from "../../helpers/evaluation/runGates.js";
import { subjectOf } from "../../helpers/evaluation/subjectOf.js";
import { requireSolution } from "../../helpers/solution/requireSolution.js";
import { withCode } from "../../helpers/solution/withCode.js";
import type { EvaluationOutcome } from "../../interfaces/evaluation/EvaluationOutcome.js";
import type { GateEnvironment } from "../../interfaces/evaluation/GateEnvironment.js";
import type { SolutionGates } from "../../interfaces/evaluation/SolutionGates.js";
import type { SonarFixLoop } from "../quality/SonarFixLoop.js";

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
    mkdirSync(path.join(workspace, AISDLC_DIR), { recursive: true });
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
        problems.push(`SonarQube issues could not be read: ${errorMessage(error)}`);
      }
    }
    const limitations = sonar.flatMap((s) => s.limitations?.() ?? []);

    for (const result of results) {
      try {
        this.store.saveEvaluation(solution.id, result);
      } catch (error) {
        console.error(`The ${result.kind} result of ${solution.id} was not saved: ${errorMessage(error)}`);
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
