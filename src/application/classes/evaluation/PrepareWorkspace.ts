import { PathGuard } from "../../../domain/classes/security/PathGuard.js";
import type { IRepoMirror } from "../../../ports/interfaces/repository/IRepoMirror.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { requireSolution } from "../../helpers/solution/requireSolution.js";

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
