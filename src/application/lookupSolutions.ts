import type { SolutionMatch } from "../domain/knowledge.js";
import { TextNormalizer } from "../domain/textNormalizer.js";
import type { ISolutionStore } from "../ports/stores.js";

export interface LookupResult {
  /** `suggest`: a confident match exists, so no model is needed. `model`: start a small model session. */
  decision: "suggest" | "model";
  matches: SolutionMatch[];
}

export interface LookupThresholds {
  minimumOverlap: number;
  /** How far the best match must lead the runner-up, as a fraction of the runner-up's relevance. */
  minimumLead: number;
  candidates: number;
}

export const DEFAULT_THRESHOLDS: LookupThresholds = { minimumOverlap: 0.6, minimumLead: 0.2, candidates: 3 };

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
