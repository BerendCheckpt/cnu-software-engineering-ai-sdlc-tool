# ADR 0010: A task is done only without open blocking SonarQube issues; after N fixes it goes to a human

- **Status:** Accepted; for clean-up batches replaced by ADR 0011
- **Date:** 2026-11-05

## Context
SonarQube projects kept open issues, including security risks, after tasks were done. A solution passed `eval` when
the quality gate said OK, and issues that were there before the task were allowed. A clean-up batch gave up after two
failed checks and the model was told to skip it. SonarQube was used once, not until the code was clean.

## Decision
- **Severities.** SonarQube's impact severities are used, `BLOCKER`, `HIGH`, `MEDIUM`, `LOW` and `INFO`. Older
  severities are mapped: `CRITICAL` is HIGH, `MAJOR` is MEDIUM, `MINOR` is LOW. `config/quality.yaml` says:
  - which severities block (`BLOCKER` and `HIGH`): a task is not done while one is open, including issues that were
    there before it;
  - which are only reported (`MEDIUM`): the model is asked to fix them, and they are listed in the reports, but they
    never fail a check;
  - `maxFixAttempts` (3).
- **One loop per task, kept by the tool.** `SonarFixLoop` records every check of a solution's `eval` and of a clean-up
  batch's `check`. A check fails when a blocking issue is open, a gate fails, a batch regressed, or SonarQube could
  not be read. The first check and `maxFixAttempts` fix attempts may fail; the next failure escalates. The count is
  stored in SQLite (`fix_loops`); the model cannot reset it.
- **Escalation is a GitHub issue in the working repository** (the mirror's `origin`). `gh issue create` runs with the
  engineer's own login, automatically and without an approval prompt, because the issue is the hand-over to a
  human. The text comes from a fixed template:
  - the task;
  - where it is (branch, commit, workspace);
  - the SonarQube link;
  - the open issues with rule links;
  - every attempt: what it fixed and what was new;
  - what the check could not see;
  - the command that reproduces it;
  - the last diff.

  The text is always written to `work/escalations/` first. A repository that is not on GitHub, or a `gh` that
  fails, gets a note saying where to open the issue by hand. A failed escalation never stalls the run.
- **After escalation.**
  - A solution becomes `escalated`. `eval` refuses it until a human runs `aisdlc reopen <id>`; that asks y/N and
    starts the count again.
  - A clean-up batch is reset and becomes `escalated`, and the run continues with the next batch. `cleanup skip` is
    refused for a batch with blocking issues. `cleanup finish` refuses while a blocking issue is neither fixed nor
    escalated, and the PR description lists the escalations.
- **Fixing a solution.** `revise` (CLI) or `revise_solution` (MCP) replaces a draft's diff; the next `eval` starts
  from a fresh copy.

## Consequences
- A task can no longer finish with an open BLOCKER or HIGH issue without a human knowing about it.
- Migrations also fix issues that were there before them. That makes them bigger, but the project ends clean.
- Security hotspots count only when the token may read them. An analysis token (`sqa_`) may not; the check, the
  report and the escalation all say so.
- Creating the issue reaches GitHub without a prompt. It is the one outward action that is automatic, and it only
  describes the problem: nothing is pushed.
