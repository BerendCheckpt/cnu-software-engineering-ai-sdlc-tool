import type { Approval } from "../domain/approval.js";
import type { CleanupBatch, CleanupRun } from "../domain/cleanup.js";
import type { DocChunk, DocSource } from "../domain/docs.js";
import type { EvaluationResult } from "../domain/evaluation.js";
import type { Application, Feedback } from "../domain/knowledge.js";
import type { FixLoop } from "../domain/quality.js";
import type { LinkedRepository } from "../domain/repository.js";
import type { Solution } from "../domain/solution.js";

export interface PromptHit {
  solutionId: string;
  /** Normalized text of the stored prompt. */
  normalizedPrompt: string;
  /** BM25 relevance, higher is better. */
  relevance: number;
}

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

export interface IApprovalStore {
  save(approval: Approval): void;
  get(id: string): Approval | undefined;
  pending(): Approval[];
  /** Pending, or approved but not yet carried out (for example after a failed download). */
  open(): Approval[];
}

export interface IDocStore {
  /** `fetchedAt` is when the page was downloaded: now, unless an archived page is chunked again. */
  replaceChunks(source: DocSource, chunks: DocChunk[], fetchedAt?: string): void;
  hasSource(sourceId: string): boolean;
  search(terms: string[], limit: number, framework?: string, version?: string): DocChunk[];
  chunksOf(sourceId: string): DocChunk[];
}

export interface ILinkedRepositoryStore {
  save(repository: LinkedRepository): void;
  get(name: string): LinkedRepository | undefined;
  all(): LinkedRepository[];
  remove(name: string): boolean;
}

export interface IFixLoopStore {
  save(loop: FixLoop): void;
  get(subject: string): FixLoop | undefined;
}

export interface ICleanupStore {
  saveRun(run: CleanupRun): void;
  run(id: string): CleanupRun | undefined;
  saveBatch(batch: CleanupBatch): void;
  batches(runId: string): CleanupBatch[];
}
