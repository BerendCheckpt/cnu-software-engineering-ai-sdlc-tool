import type { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { Solution } from "../../../domain/classes/solution/Solution.js";
import type { Application } from "../../../domain/interfaces/knowledge/Application.js";
import type { Feedback } from "../../../domain/interfaces/knowledge/Feedback.js";
import type { PromptHit } from "./PromptHit.js";

export interface ISolutionStore {
  save(solution: Solution): void;
  get(id: string): Solution | undefined;
  /** Indexes a prompt as resolved by a solution, for exact and BM25 lookup. */
  indexPrompt(solutionId: string, prompt: string): void;
  findByPromptHash(hash: string): string[];
  searchPrompts(terms: string[], limit: number): PromptHit[];
  saveEvaluation(solutionId: string, result: EvaluationResult): void;
  evaluations(solutionId: string): EvaluationResult[];
  saveApplication(application: Application): void;
  applications(solutionId: string): Application[];
  saveFeedback(feedback: Feedback): void;
  addToPlan(plan: string, solutionId: string): void;
  plan(plan: string): Solution[];
}
