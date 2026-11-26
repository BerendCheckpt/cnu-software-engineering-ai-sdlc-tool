import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { Solution } from "../../../domain/classes/solution/Solution.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";

/** A human accepts an evaluated solution. From then on, the front door can suggest it. */
export class AcceptSolution {
  constructor(private readonly store: ISolutionStore) {}

  execute(solutionId: string): Solution {
    const solution = this.require(solutionId);
    solution.moveTo("accepted");
    this.store.save(solution);
    this.store.indexPrompt(solution.id, solution.prompt);
    return solution;
  }

  private require(id: string): Solution {
    const solution = this.store.get(id);
    if (!solution) throw new DomainError(`No solution ${id}.`);
    return solution;
  }
}
