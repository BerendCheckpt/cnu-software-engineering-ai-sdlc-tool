import type { EvaluationResult } from "./evaluation.js";
import type { Solution } from "./solution.js";

/** Where a solution has been applied. */
export interface Application {
  solutionId: string;
  repository: string;
  commit: string;
  files: string[];
  pullRequestUrl?: string;
}

/** Why an engineer rejected a suggestion. */
export interface Feedback {
  solutionId: string;
  reason: string;
  createdAt: string;
}

/** A solution found for a prompt, with what proves it and where it was used. */
export interface SolutionMatch {
  solution: Solution;
  /** Term overlap (Dice coefficient) between the prompt and the stored prompt; 1 for an exact match. */
  overlap: number;
  /** FTS5 BM25 relevance, higher is better (0 for an exact match). */
  relevance: number;
  exact: boolean;
  evaluations: EvaluationResult[];
  applications: Application[];
}
