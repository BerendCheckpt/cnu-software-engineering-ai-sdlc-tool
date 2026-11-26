import { Solution } from "../../../domain/classes/solution/Solution.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";

/** A model or an engineer proposes a solution. It stays a draft until it is evaluated and a human accepts it. */
export class ProposeSolution {
  constructor(private readonly store: ISolutionStore) {}

  execute(prompt: string, summary: string, diff: string): Solution {
    const solution = Solution.propose(prompt, summary, diff);
    this.store.save(solution);
    return solution;
  }
}
