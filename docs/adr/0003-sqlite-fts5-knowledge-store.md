# ADR 0003: SQLite with FTS5 as the knowledge store

- **Status:** Accepted
- **Date:** 2026-11-03

## Context
The store holds prompts, solutions, evaluations, applications, feedback, approvals and documentation chunks. It needs
deterministic ranked text search, and it must be easy to share read-only with other engineers' Claude Code sessions.

## Decision
One SQLite file (`knowledge/knowledge.db`) through Node's built-in `node:sqlite`, with FTS5 tables for prompts and
documentation chunks. FTS5's `bm25()` does the ranking.

We use `node:sqlite` instead of `better-sqlite3` because it needs no native build on Windows or in the cnu-claude-agent
image (Node 22.13+ ships it without a flag).

## Consequences
- **+** Zero operations, deterministic ranking, and one file to copy or mount read-only.
- **+** The store sits behind `IKnowledgeStore`, so PostgreSQL can replace it without touching any use case.
- **−** Single writer. Fine for a proof of concept; a shared server is a later decision.
