export interface PromptHit {
  solutionId: string;
  /** Normalized text of the stored prompt. */
  normalizedPrompt: string;
  /** BM25 relevance, higher is better. */
  relevance: number;
}
