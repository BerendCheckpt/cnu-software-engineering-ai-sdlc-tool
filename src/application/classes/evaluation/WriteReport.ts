import path from "node:path";
import { PathGuard } from "../../../domain/classes/security/PathGuard.js";
import type { IReportWriter } from "../../../ports/interfaces/evaluation/IReportWriter.js";
import type { IFixLoopStore } from "../../../ports/interfaces/quality/IFixLoopStore.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { latestPerKind } from "../../../shared/helpers/evaluation/latestPerKind.js";
import { writeTextFile } from "../../../shared/helpers/workspace/writeTextFile.js";
import { subjectOf } from "../../helpers/evaluation/subjectOf.js";
import { requireSolution } from "../../helpers/solution/requireSolution.js";

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
    const markdown = this.writer.render(solution, latestPerKind(this.store.evaluations(solution.id)), summary,
      last ? [...last.blocking, ...last.reported] : undefined);
    const file = path.join(this.work.resolve(solution.id), "report.md");
    writeTextFile(file, markdown);
    return { path: file, markdown };
  }
}
