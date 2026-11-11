# ADR 0011: A clean-up batch is done only when all its findings are gone; after 5 tries the engineer decides

- **Status:** Accepted; replaces the clean-up part of ADR 0010
- **Date:** 2026-11-11

## Context
Clean-up run `b4b98e00` committed batch 1 on its first check while SonarQube still reported both of the batch's
code smells (`javascript:S8786`, MEDIUM). Under ADR 0010 only BLOCKER and HIGH issues failed a check, so MEDIUM code
smells were "reported" and never held a batch back. After too many failures, the batch was reset and a GitHub issue
was opened without asking anyone.

## Decision
- **Done means clean.** A clean-up batch is committed only when every one of its own findings is gone, whatever its
  severity or source, and nothing got worse (ADR 0009's comparison). `cleanup skip` is refused for a batch with
  SonarQube findings.
- **Severity level.** `cleanup analyze <mirror> --severity verbose|medium|high` (default `verbose`) sets which
  SonarQube findings the run must fix: `verbose` every severity, `medium` MEDIUM and above, `high` HIGH and BLOCKER.
  Findings below the level are not planned into batches; they stay in the run's SonarQube project, which `finish`
  then keeps instead of deleting. The PR lists their count per severity with the project name and asks for GitHub
  issues to be created for them later. Secrets and vulnerable dependencies are always planned. Claude sessions and
  agents do not pass the option, so they run at `verbose`.
- **5 tries.** `config/cleanup.yaml` `batches.maxTries` (5) is how often a batch may be checked. The count is kept
  in SQLite (`fix_loops`), as in ADR 0010; the model cannot reset it.
- **Then the engineer decides.** When the last try fails, the batch becomes `waiting`, its change stays in the
  workspace, and `next` and `check` refuse to go on. The skill asks the engineer:
  - **Retry** (`cleanup retry <run>`): the count starts again and the batch gets 5 more tries.
  - **PR and issues** (`cleanup escalate <run>`): the batch's partial fix is committed when it made nothing worse,
    and reset otherwise. One GitHub issue is opened per finding left, each written to `work/escalations/` first; a
    failed issue is logged and does not stop the others. The batch becomes `escalated` and the run goes on; `finish`
    opens the PR, which lists the issues.
- Solutions (`eval`) keep ADR 0010 unchanged: blocking severities, `maxFixAttempts` and the automatic issue.

## Consequences
- No batch commits with its own code smells still open unless the engineer said so.
- An unattended run can stop half-way and wait for a person. That is intended: the PR is still the review, but
  giving up on a finding is now the engineer's call.
