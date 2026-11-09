import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS solutions (
  id TEXT PRIMARY KEY, prompt TEXT NOT NULL, summary TEXT NOT NULL, diff TEXT NOT NULL,
  state TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY, solution_id TEXT NOT NULL REFERENCES solutions(id), hash TEXT NOT NULL,
  normalized TEXT NOT NULL, UNIQUE (solution_id, hash));
CREATE INDEX IF NOT EXISTS prompts_hash ON prompts(hash);
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(normalized, content='prompts', content_rowid='id');
CREATE TABLE IF NOT EXISTS evaluations (
  solution_id TEXT NOT NULL REFERENCES solutions(id), kind TEXT NOT NULL, passed INTEGER NOT NULL,
  digest TEXT NOT NULL, report_path TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS applications (
  solution_id TEXT NOT NULL REFERENCES solutions(id), repository TEXT NOT NULL, commit_sha TEXT NOT NULL,
  files TEXT NOT NULL, pull_request_url TEXT);
CREATE TABLE IF NOT EXISTS feedback (
  solution_id TEXT NOT NULL REFERENCES solutions(id), reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan_items (
  plan TEXT NOT NULL, solution_id TEXT NOT NULL REFERENCES solutions(id), PRIMARY KEY (plan, solution_id));
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL,
  requested_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT);
CREATE TABLE IF NOT EXISTS doc_sources (
  id TEXT PRIMARY KEY, framework TEXT NOT NULL, version TEXT NOT NULL, url TEXT NOT NULL, fetched_at TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks USING fts5(
  source_id UNINDEXED, framework UNINDEXED, version UNINDEXED, heading, content, url UNINDEXED);
CREATE TABLE IF NOT EXISTS cleanup_runs (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cleanup_batches (
  run_id TEXT NOT NULL REFERENCES cleanup_runs(id), number INTEGER NOT NULL, status TEXT NOT NULL,
  data TEXT NOT NULL, PRIMARY KEY (run_id, number));
CREATE TABLE IF NOT EXISTS fix_loops (subject TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS linked_repositories (
  name TEXT PRIMARY KEY COLLATE NOCASE, path TEXT NOT NULL, linked_at TEXT NOT NULL);
`;

/** Opens the knowledge file and makes sure the schema exists. `:memory:` is for tests. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

/** An FTS5 query matching any of the terms as a prefix. Each term is quoted, so it is never read as syntax. */
export function ftsAnyOf(terms: string[]): string | undefined {
  const quoted = [...new Set(terms)].filter(Boolean).map((t) => `"${t.replaceAll('"', '""')}"*`);
  return quoted.length ? quoted.join(" OR ") : undefined;
}
