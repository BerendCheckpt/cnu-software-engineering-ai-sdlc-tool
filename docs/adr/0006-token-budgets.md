# ADR 0006: Token and tool budgets are enforced in code

- **Status:** Accepted. Turn and output budgets apply today through cnu-claude-agent's existing settings; the per-call
  tool budget and thinking switch need that repository's owners ([ADR 0007](0007-chat-gateway-in-front-of-cnu-claude-agent.md)).
- **Date:** 2026-11-03

## Context
Telling a model to "be brief" did not stop runaway turns. In the support benchmarks, 21 turns hit the 32k output limit,
some without a single tool call, and 62 turns timed out after many tool calls.

## Decision
The coding profile in cnu-claude-agent enforces:

| Budget | Value | Where |
|---|---|---|
| Turns | 8 | `maxTurns` |
| Tool calls | 6 | counted in `canUseTool`; the 7th is denied with "write up what you have" |
| Thinking | off | `maxThinkingTokens: 0`, or Qwen's no-think mode |
| Output tokens | 4096 | `CLAUDE_CODE_MAX_OUTPUT_TOKENS` |
| Tool result size | 5 hits, 40 to 60 lines | truncated by the MCP server |
| Session | fresh per task | long sessions are not resumed; a recap is passed instead |

When a budget runs out, the reply is a forced wrap-up of what the model has (cnu-claude-agent's `maxTurnsReply`).

## Consequences
- **+** Worst-case cost and latency per task become known numbers, which is what a benchmark needs.
- **−** Hard tasks may end with a partial answer. The result shows this, and it is a signal to add knowledge or a tool,
  not to raise the budget.
