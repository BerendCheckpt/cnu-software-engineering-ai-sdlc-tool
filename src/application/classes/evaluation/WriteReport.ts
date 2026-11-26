import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import { PathGuard } from "../../../domain/classes/security/PathGuard.js";
import type { IReportWriter } from "../../../ports/interfaces/evaluation/IReportWriter.js";
import type { IFixLoopStore } from "../../../ports/interfaces/quality/IFixLoopStore.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { requireSolution } from "../../helpers/evaluation/requireSolution.js";
import { subjectOf } from "../../helpers/evaluation/subjectOf.js";

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
