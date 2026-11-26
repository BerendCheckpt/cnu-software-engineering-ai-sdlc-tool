import type { Solution } from "../../../domain/classes/solution/Solution.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { requireSolution } from "../../helpers/solution/requireSolution.js";

/** A human accepts an evaluated solution. From then on, the front door can suggest it. */
export class AcceptSolution {
  constructor(private readonly store: ISolutionStore) {}

  execute(solutionId: string): Solution {
    const solution = requireSolution(this.store, solutionId);
    solution.moveTo("accepted");
    this.store.save(solution);
    this.store.indexPrompt(solution.id, solution.prompt);
    return solution;
  }
}
