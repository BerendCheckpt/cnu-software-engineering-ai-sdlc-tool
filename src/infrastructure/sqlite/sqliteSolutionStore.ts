import type { DatabaseSync } from "node:sqlite";
import { EvaluationResult, type EvaluationKind } from "../../domain/evaluation.js";
import type { Application, Feedback } from "../../domain/knowledge.js";
import { Solution, type SolutionState } from "../../domain/solution.js";
import { TextNormalizer } from "../../domain/textNormalizer.js";
import type { ISolutionStore, PromptHit } from "../../ports/stores.js";
import { ftsAnyOf } from "./database.js";

type Row = Record<string, unknown>;

export class SqliteSolutionStore implements ISolutionStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly normalizer = new TextNormalizer(),
  ) {}

  save(solution: Solution): void {
    const p = solution.toProps();
    this.db
      .prepare(`INSERT INTO solutions (id, prompt, summary, diff, state, created_at) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, diff = excluded.diff, state = excluded.state`)
      .run(p.id, p.prompt, p.summary, p.diff, p.state, p.createdAt);
  }

  get(id: string): Solution | undefined {
    const row = this.db.prepare("SELECT * FROM solutions WHERE id = ?").get(id) as Row | undefined;
    return row ? this.toSolution(row) : undefined;
  }

  indexPrompt(solutionId: string, prompt: string): void {
    const normalized = this.normalizer.normalize(prompt);
    const result = this.db
      .prepare("INSERT OR IGNORE INTO prompts (solution_id, hash, normalized) VALUES (?, ?, ?)")
      .run(solutionId, this.normalizer.hash(prompt), normalized);
    if (result.changes > 0) {
      this.db.prepare("INSERT INTO prompts_fts (rowid, normalized) VALUES (?, ?)").run(result.lastInsertRowid, normalized);
    }
  }

  findByPromptHash(hash: string): string[] {
    const rows = this.db.prepare("SELECT DISTINCT solution_id FROM prompts WHERE hash = ?").all(hash) as Row[];
    return rows.map((r) => String(r.solution_id));
  }

  searchPrompts(terms: string[], limit: number): PromptHit[] {
    const query = ftsAnyOf(terms);
    if (!query) return [];
    const rows = this.db
      .prepare(`SELECT p.solution_id, p.normalized, bm25(prompts_fts) AS score
                FROM prompts_fts JOIN prompts p ON p.id = prompts_fts.rowid
                WHERE prompts_fts MATCH ? ORDER BY score LIMIT ?`)
      .all(query, limit) as Row[];
    return rows.map((r) => ({
      solutionId: String(r.solution_id),
      normalizedPrompt: String(r.normalized),
      relevance: -Number(r.score),
    }));
  }

  saveEvaluation(solutionId: string, result: EvaluationResult): void {
    this.db
      .prepare("INSERT INTO evaluations (solution_id, kind, passed, digest, report_path, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(solutionId, result.kind, result.passed ? 1 : 0, result.digest, result.reportPath ?? null, new Date().toISOString());
  }

  evaluations(solutionId: string): EvaluationResult[] {
    const rows = this.db
      .prepare("SELECT * FROM evaluations WHERE solution_id = ? ORDER BY created_at")
      .all(solutionId) as Row[];
    return rows.map((r) => new EvaluationResult(
      r.kind as EvaluationKind, r.passed === 1, String(r.digest), r.report_path ? String(r.report_path) : undefined));
  }

  saveApplication(a: Application): void {
    this.db
      .prepare("INSERT INTO applications (solution_id, repository, commit_sha, files, pull_request_url) VALUES (?, ?, ?, ?, ?)")
      .run(a.solutionId, a.repository, a.commit, JSON.stringify(a.files), a.pullRequestUrl ?? null);
  }

  applications(solutionId: string): Application[] {
    const rows = this.db.prepare("SELECT * FROM applications WHERE solution_id = ?").all(solutionId) as Row[];
    return rows.map((r) => ({
      solutionId: String(r.solution_id),
      repository: String(r.repository),
      commit: String(r.commit_sha),
      files: JSON.parse(String(r.files)) as string[],
      ...(r.pull_request_url ? { pullRequestUrl: String(r.pull_request_url) } : {}),
    }));
  }

  saveFeedback(f: Feedback): void {
    this.db.prepare("INSERT INTO feedback (solution_id, reason, created_at) VALUES (?, ?, ?)").run(f.solutionId, f.reason, f.createdAt);
  }

  addToPlan(plan: string, solutionId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO plan_items (plan, solution_id) VALUES (?, ?)").run(plan, solutionId);
  }

  plan(plan: string): Solution[] {
    const rows = this.db
      .prepare("SELECT s.* FROM plan_items i JOIN solutions s ON s.id = i.solution_id WHERE i.plan = ? ORDER BY s.created_at")
      .all(plan) as Row[];
    return rows.map((r) => this.toSolution(r));
  }

  private toSolution(r: Row): Solution {
    return Solution.restore({
      id: String(r.id),
      prompt: String(r.prompt),
      summary: String(r.summary),
      diff: String(r.diff),
      state: r.state as SolutionState,
      createdAt: String(r.created_at),
    });
  }
}
