# ADR 0002: One coarse MCP server instead of Bash, Read and Grep

- **Status:** Accepted. The MCP server is built and works in any Claude Code session. Using it *instead of* the
  built-in tools inside cnu-claude-agent needs that repository's owners ([ADR 0007](0007-chat-gateway-in-front-of-cnu-claude-agent.md)).
- **Date:** 2026-11-03

## Context
In run 1793258147 the local model made 1201 Bash and 559 Read calls. Turns that timed out made 13 to 58 tool calls
each. Built-in tools return unbounded output, and every result is re-sent with every following turn.

## Decision
The coding profile gives the model exactly seven tools from one stdio MCP server (`aisdlc`), each with a one-line
description: `find_solutions`, `search_docs`, `search_code`, `read_snippet`, `request_approval`, `propose_solution`,
`run_evaluations`. The server bounds every result (at most 5 hits, 40 to 60 lines). `Bash`, `Read`, `Grep` and `Glob`
are disallowed.

### Alternatives
- **Skills + scripts through Bash** (what cnu-claude-agent does today). The model has to compose CLI flags, which small
  models get wrong, and output is unbounded unless every script caps it.
- **Plain HTTP API.** Needs its own tool wrapper anyway.
- **MCP.** The Agent SDK sends typed JSON schemas, which local models fill in far more reliably than flags, and
  `canUseTool` can count calls per tool. Chosen.

The same use cases are exposed through the CLI (humans, CI, the skill) and as a library (the front door), so MCP is an
adapter, not the core.

## Consequences
- **+** Every tool result has a known upper bound, so context growth per turn is predictable.
- **+** Tool descriptions are short and stable, so prompt caching applies.
- **−** The model cannot explore beyond what the tools allow. That is the point: a missing capability becomes a new,
  reviewed tool.
