# ADR 0001: Deterministic front door before any model

- **Status:** Accepted
- **Date:** 2026-11-03

## Context
Engineers repeat requests that have already been solved, evaluated and accepted. Sending those to a model costs
output tokens, tool calls and latency, and adds non-determinism to work that humans have already reviewed. In the
support benchmarks, the model spent 3 to 58 tool calls per question, including on questions it had effectively
answered before.

## Decision
Every prompt passes a front door first. The front door is a library call, not a model:
1. normalize the prompt (lowercase, stop words, light stemming);
2. exact match on the SHA-256 of the normalized text;
3. otherwise BM25 over the prompts of accepted solutions (SQLite FTS5);
4. suggest only when the term overlap with the best stored prompt is at least 0.6 and its BM25 score leads the
   runner-up by at least 20 %. Overlap is the Dice coefficient, `2·|shared| / (|prompt| + |stored|)`, which counts
   terms on both sides. That way neither a short prompt inside a long stored prompt, nor the other way round, counts
   as a match.

A confident hit is answered with the solution, its evaluations and where it was applied: 0 model tokens. A miss, or a
suggestion the engineer rejects, starts a small, budgeted model session that receives the rejection reason and the
top 3 candidates.

## Consequences
- **+** The largest saving on all three goals: no output tokens, no tool calls, no context.
- **+** Only results that humans already accepted are reused, which is what makes reuse safe.
- **−** Lexical matching misses paraphrases. The threshold is deliberately conservative: a miss costs a model session,
  a wrong hit costs trust.
- **−** cnu-claude-agent needs a small change to call the front door before `query()`
  ([integration](../integration-cnu-claude-agent.md)).
