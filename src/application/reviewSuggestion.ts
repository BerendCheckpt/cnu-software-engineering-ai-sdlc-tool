import { DomainError } from "../domain/errors.js";
import { SessionBrief } from "../domain/sessionBrief.js";
import type { Solution } from "../domain/solution.js";
import type { ISolutionStore } from "../ports/stores.js";
import type { LookupSolutions } from "./lookupSolutions.js";

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

/** The engineer rejects a suggestion: the reason is kept, and a model session starts from it. */
export class RejectSuggestion {
  constructor(
    private readonly store: ISolutionStore,
    private readonly lookup: LookupSolutions,
  ) {}

  execute(solutionId: string, prompt: string, reason: string): SessionBrief {
    if (!reason.trim()) throw new DomainError("Say why the suggestion does not fit; the model starts from that.");
    if (!this.store.get(solutionId)) throw new DomainError(`No solution ${solutionId}.`);
    this.store.saveFeedback({ solutionId, reason, createdAt: new Date().toISOString() });
    const candidates = this.lookup.execute(prompt).matches;
    return new SessionBrief(prompt, candidates, reason);
  }
}
