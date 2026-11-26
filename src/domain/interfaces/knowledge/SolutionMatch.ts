import type { EvaluationResult } from "../../classes/evaluation/EvaluationResult.js";
import type { Solution } from "../../classes/solution/Solution.js";
import type { Application } from "./Application.js";

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
