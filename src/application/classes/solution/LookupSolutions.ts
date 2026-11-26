import { TextNormalizer } from "../../../domain/classes/knowledge/TextNormalizer.js";
import type { SolutionMatch } from "../../../domain/interfaces/knowledge/SolutionMatch.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { DEFAULT_THRESHOLDS } from "../../constants/solution/DEFAULT_THRESHOLDS.js";
import type { LookupResult } from "../../interfaces/solution/LookupResult.js";
import type { LookupThresholds } from "../../interfaces/solution/LookupThresholds.js";

/** Finds accepted solutions for a prompt without a model: exact hash first, then BM25. */
export class LookupSolutions {
  constructor(
    private readonly store: ISolutionStore,
    private readonly thresholds: LookupThresholds = DEFAULT_THRESHOLDS,
    private readonly normalizer = new TextNormalizer(),
  ) {}

  execute(prompt: string): LookupResult {
    const exact = this.exactMatches(prompt);
    if (exact.length) return { decision: "suggest", matches: exact };

    const ranked = this.rankedMatches(prompt);
    return { decision: this.isConfident(ranked) ? "suggest" : "model", matches: ranked };
  }

  private exactMatches(prompt: string): SolutionMatch[] {
    return this.store
      .findByPromptHash(this.normalizer.hash(prompt))
      .map((id) => this.toMatch(id, 1, 0, true))
      .filter((m): m is SolutionMatch => m !== undefined)
      .slice(0, this.thresholds.candidates);
  }

  private rankedMatches(prompt: string): SolutionMatch[] {
    const terms = this.normalizer.terms(prompt);
    const best = new Map<string, SolutionMatch>();
    for (const hit of this.store.searchPrompts(terms, 20)) {
      if (best.has(hit.solutionId)) continue;
      const match = this.toMatch(hit.solutionId, this.overlap(terms, hit.normalizedPrompt.split(" ")), hit.relevance, false);
      if (match) best.set(hit.solutionId, match);
    }
    return [...best.values()].slice(0, this.thresholds.candidates);
  }

  private isConfident([top, runnerUp]: SolutionMatch[]): boolean {
    if (!top || top.overlap < this.thresholds.minimumOverlap) return false;
    return !runnerUp || top.relevance >= runnerUp.relevance * (1 + this.thresholds.minimumLead);
  }

  /** Dice coefficient over distinct terms. */
  private overlap(a: string[], b: string[]): number {
    const left = new Set(a);
    const right = new Set(b);
    if (!left.size || !right.size) return 0;
    const shared = [...left].filter((t) => right.has(t)).length;
    return (2 * shared) / (left.size + right.size);
  }

  private toMatch(solutionId: string, overlap: number, relevance: number, exact: boolean): SolutionMatch | undefined {
    const solution = this.store.get(solutionId);
    if (!solution?.isSuggestable) return undefined;
    return {
      solution,
      overlap,
      relevance,
      exact,
      evaluations: this.store.evaluations(solutionId),
      applications: this.store.applications(solutionId),
    };
  }
}
