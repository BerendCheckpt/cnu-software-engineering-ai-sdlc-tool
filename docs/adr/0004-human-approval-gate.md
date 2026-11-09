# ADR 0004: Human approval gate for downloads, clones and crystallization

- **Status:** Accepted. Extended by [ADR 0009](0009-cleanup-gates-from-the-diff.md): the clean-up adds `cleanup-plan`, `cleanup-change` and `push` approvals, and `approve` and `deny` now need an interactive terminal.
- **Date:** 2026-11-03

## Context
The agent may download missing documentation once, and clone a repository it needs, but only with permission. A model
that "hears a yes" in its own context has not been given permission.

## Decision
- The model (through MCP) can only **request** an approval. It gets back an id and the status `pending`.
- Only the CLI, run by a human, can `approve` or `deny`. No MCP tool decides approvals.
- An approved download fetches only from hosts on the allow-list in `config/sources.yaml`. An approved clone runs
  `git clone --depth 1 <https url>` through `execFile` (no shell), and refuses URLs that carry credentials or point to
  hosts outside the allow-list.
- Every decision records who decided it and when.

## Consequences
- **+** Prompt injection in a document, a repository or a prompt cannot trigger a download or a clone.
- **−** One extra human step per new source. Each source is downloaded only once, so this is rare.
