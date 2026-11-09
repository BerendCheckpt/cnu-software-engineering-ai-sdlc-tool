import { DomainError } from "../domain/errors.js";
import type { Application } from "../domain/knowledge.js";
import { Solution } from "../domain/solution.js";
import type { ISolutionStore } from "../ports/stores.js";

/** A model or an engineer proposes a solution. It stays a draft until it is evaluated and a human accepts it. */
export class ProposeSolution {
  constructor(private readonly store: ISolutionStore) {}

  execute(prompt: string, summary: string, diff: string): Solution {
    const solution = Solution.propose(prompt, summary, diff);
    this.store.save(solution);
    return solution;
  }
}

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

/** Records where a solution has been applied, so later suggestions can show it. */
export class RecordApplication {
  constructor(private readonly store: ISolutionStore) {}

  execute(application: Application): void {
    if (!this.store.get(application.solutionId)) throw new DomainError(`No solution ${application.solutionId}.`);
    this.store.saveApplication(application);
  }
}
