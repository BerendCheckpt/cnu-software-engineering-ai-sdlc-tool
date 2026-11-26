import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { Solution } from "../../../domain/classes/solution/Solution.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";

/** The engineer accepts a suggestion: it goes into their implementation plan. */
export class AcceptSuggestion {
  constructor(private readonly store: ISolutionStore) {}

  execute(solutionId: string, prompt: string, plan = "current"): Solution {
    const solution = this.store.get(solutionId);
    if (!solution?.isSuggestable) throw new DomainError(`No accepted solution ${solutionId}.`);
    this.store.addToPlan(plan, solutionId);
    // The prompt that led here becomes another way to find the same solution.
    this.store.indexPrompt(solutionId, prompt);
    return solution;
  }
}
