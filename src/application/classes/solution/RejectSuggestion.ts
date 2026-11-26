import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { SessionBrief } from "../../../domain/classes/knowledge/SessionBrief.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import type { LookupSolutions } from "./LookupSolutions.js";

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
