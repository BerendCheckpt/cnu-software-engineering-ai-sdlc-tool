# ADR 0007: A chat gateway in front of cnu-claude-agent, which stays unchanged

- **Status:** Accepted
- **Date:** 2026-11-03

## Context
cnu-claude-agent is the runtime: it hosts the Claude Agent SDK, talks to Ollama, and serves `POST /chat?stream=1`,
which the benchmark harness drives. That repository is **read-only** for this work, so the coding profile cannot be
added inside it (an earlier plan in [the integration notes](../integration-cnu-claude-agent.md) assumed it could).

## Decision
`aisdlc` serves the same `/chat` contract itself, as a gateway in front of an unchanged cnu-claude-agent
(`src/adapters/gateway`, `npm run gateway`):
- A **new, text-only** conversation (no `sessionId`, no attachments) passes the front door (ADR 0001).
  - A confident match is answered by the gateway in the upstream's own shapes: SSE `delta` + `result`, or JSON, with
    `turns: 0`, `costUsd: 0` and `route: "front-door"`. No model is called.
  - Otherwise the request is forwarded with `message` replaced by the short session brief.
- Every other request (follow-ups, attachments, other routes, no bearer token) is forwarded unchanged.
- The upstream response is streamed back byte for byte. The bearer token is passed on and never logged.
- An `x-aisdlc-route` response header says `front-door`, `model` or `passthrough`.
- The benchmark switches to the gateway by setting `AGENT_BASE_URL`; neither repository changes.

## Consequences
- **+** The biggest saving (no model at all for known requests) works now, without touching cnu-claude-agent.
- **+** Turn and output budgets are already settings of the container (`CHAT_MAX_TURNS`,
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS`), so ADR 0006's main budgets apply without code changes.
- **−** Not possible from outside: replacing the agent's built-in tools with the `aisdlc` MCP server (ADR 0002), the
  per-call tool budget, the `gate-diagnoser` sub-agent, and token counts in the `result` event. These need a change in
  cnu-claude-agent by its owners.
- **−** The gateway does not validate tokens; it only requires one before answering from knowledge. It listens on
  localhost by default. Exposed beyond that, knowledge answers would reach anyone who sends any bearer string.
