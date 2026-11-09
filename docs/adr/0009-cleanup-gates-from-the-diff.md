# ADR 0009: Clean-up batches are judged by code, and gated from the diff

- **Status:** Accepted
- **Date:** 2026-11-03

## Context
Claude Code is asked to clean up repositories it may itself have written badly. Its own judgement of "done" or of
"this needs a human" cannot be the check. The engineer wants a plan first, a valid PR at the end, and human gates
for some kinds of change.

## Decision
- **Plan first.** `cleanup analyze` measures the workspace and splits the findings into batches. The policy in
  `config/cleanup.yaml` sets the category order and the limits: at most 10 findings and 5 files per batch. Nothing
  changes before a human approves the `cleanup-plan` approval.
- **Valid means at least as good.** `ValidPr` compares each check with the last accepted measurement. A batch is not
  committed when:
  - a gate that passed fails;
  - a test that passed fails;
  - there are fewer tests;
  - coverage is lower;
  - a gate stopped running;
  - or there is a new finding.

  Findings are compared without their line number, so a finding that only moved is not new. `cleanup finish`
  compares the whole branch with the baseline.
- **Gates come from the diff, not from the model.** `DiffClassifier` reads everything changed since the batch
  started, including commits made in the workspace, so a commit cannot hide a change.

  | Gate | When |
  |---|---|
  | `tests` | an existing test file is changed or deleted. Adding tests is not gated. |
  | `dependency` | a package manifest, lockfile, `.csproj` or `Directory.*.props` changes |
  | `security` | a security batch, a security-sensitive path, or a changed line that matches a security pattern |

  These are not gated: removing dead code, changing public members (C#) or exports (TS), and behaviour changes.
  Behaviour changes surface as failing tests and are refused as regressions.
- **An approval covers one exact diff.** A `cleanup-change` approval names the diff's SHA-256, and the batch is
  committed only if the diff is unchanged when the human approves. A different diff gets its own approval. A denial
  resets the workspace to where the batch started.
- **Approvals need a person.** `approve` and `deny` refuse to run without an interactive terminal, and ask for
  confirmation. An agent's tool call has no terminal, so even an agent that ignores the skill's rules cannot approve
  its own change.
- **One push, after approval.** `cleanup finish` writes the PR body and asks for a `push` approval. Approving it
  pushes the branch and runs `gh pr create` once; a failure can be retried. Hosts other than GitHub get the branch and
  a note to open the PR by hand.

## Consequences
- **+** The engineer reviews small diffs, and only the ones that need a person.
- **+** The PR says what was fixed and what was skipped and why, from a fixed template, at no token cost.
- **−** The patterns are heuristics. They err towards asking: a file named `TokenParser.cs` is gated as security.
- **−** A finding the tools do not report cannot be planned. The clean-up is as good as Sonar, gitleaks and the
  audits.
