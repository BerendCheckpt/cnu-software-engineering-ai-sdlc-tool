import { rmSync } from "node:fs";
import { PathGuard } from "../../../domain/classes/security/PathGuard.js";
import type { Solution } from "../../../domain/classes/solution/Solution.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { requireSolution } from "../../helpers/solution/requireSolution.js";

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
