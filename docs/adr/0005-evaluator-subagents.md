# ADR 0005: Deterministic parallel gates, sub-agents only to diagnose failures

- **Status:** Accepted. The clean-up runs the scanner itself, in a container ([ADR 0008](0008-ephemeral-containers-for-gates.md)).
- **Date:** 2026-11-03

## Context
Solutions are evaluated with xUnit, Vitest (or Angular's test runner) and SonarQube, in parallel, and the result goes
into the pull request. Raw test output is large, and letting it into the main context is exactly the growth we want to
avoid. On a local model, every sub-agent adds turns.

## Decision
- Each technology is an `IEvaluator` (`XunitEvaluator`, `VitestEvaluator`, `SonarEvaluator`). `RunEvaluations` runs
  them with `Promise.all` and stores a digest of at most 1 KB per gate. A gate that does not apply to the workspace
  reports `skipped`.
- Running the gates needs no model at all, so it is one deterministic tool call (`run_evaluations`), not a sub-agent
  per gate.
- The sub-agent is used where a model adds something: one `gate-diagnoser` per **failed** gate, in parallel, with only
  the read-only code and docs tools ([integration](../integration-cnu-claude-agent.md)).
- `MarkdownReportWriter` builds the PR report from the digests with a fixed template. An engineer or the model may add
  a short summary (`aisdlc report <id> --summary`).

### SonarQube, first version
`SonarEvaluator` reads the quality gate and key measures of the project's latest analysis from the existing server,
with `SONAR_HOST_URL` and `SONAR_TOKEN` taken from the environment. It does not run the scanner yet: the .NET scanner
needs begin/build/end steps, and the scanner scripts are `.bat`/`.cmd` files on Windows, which cannot run without a
shell. Running the scan is the next step; until then, the digest names the analysed project so a reviewer can tell
which analysis was read.

## Consequences
- **+** Test logs never enter the main context, and passing gates cost no tokens.
- **+** Adding NUnit, Jest or `ng test` means adding one class; nothing else changes.
- **−** The digest is lossy, so every evaluation keeps the path of its full report for a human to open.
- **−** Until the scanner runs per workspace, the SonarQube gate reflects the project's last analysis, not the
  solution itself.
