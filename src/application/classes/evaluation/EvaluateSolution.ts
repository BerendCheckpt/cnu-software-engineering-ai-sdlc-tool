import { existsSync } from "node:fs";
import { PathGuard } from "../../../domain/classes/security/PathGuard.js";
import type { EvaluationOutcome } from "../../interfaces/evaluation/EvaluationOutcome.js";
import { PrepareWorkspace } from "./PrepareWorkspace.js";
import { RunEvaluations } from "./RunEvaluations.js";
import { WriteReport } from "./WriteReport.js";

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
