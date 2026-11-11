---
name: aisdlc-cleanup
description: Clean up a repository so its code is readable, maintainable, secure and up to quality standards, ending in a pull request. Runs in automode: batch by batch with no approvals in between, and the pull request (with a changelog ranked by severity and the security concerns) is the review. Use when an engineer asks to "clean up", "tidy", "refactor for quality", "fix the Sonar issues" or "make this repo maintainable", or wants a quality PR for a repository.
---

# aisdlc clean-up (automode)

The `aisdlc` CLI measures a repository and turns what it finds into a plan of small batches. It checks every batch
you make, commits the ones that pass, and at the end pushes one branch and opens the PR. Nobody approves anything on
the way: the engineer reviews the pull request.
- **Measuring.** Builds, tests, the SonarQube scan, gitleaks and the dependency audits run in throw-away containers.
- **The plan.** Findings are split into small batches, ordered security, bugs, dependencies, maintainability,
  readability. One branch per run: `cleanup/DD-MM-YYYY-HHmmss`. If that branch already exists, a clean-up or migration
  already ran on this data and `analyze` refuses.
- **Checking each batch.** The whole repository is measured again and compared with the last committed measurement.
  A batch is done only when **every** one of its findings is gone (code smells of any severity included) and nothing
  got worse. It gets 5 tries; after the 5th failed try the run stops and the engineer decides. A batch that changes
  tests, dependencies or security-sensitive code is committed and flagged in the PR.
- **The PR.** `finish` writes the PR body (changelog of every fixed finding ranked by severity, every security
  finding with its status and the pulled docs about it, the changes to review closely), pushes and opens the PR.

Your job is the part in the middle: fix the findings of one batch at a time. You run the CLI yourself; the engineer
does not need to use aisdlc separately.

Run commands as `node "$AISDLC_HOME/dist/adapters/cli/main.js" <command>` (or `aisdlc <command>` when it is linked).
Output is short by design; act on what it says. Steps are also printed live on stderr.

## Session

Name this Claude Code session `aisdlc-cleanup-<DD-MM-YYYY-HHmmss>` (the current local time; set it as the session title when you can).
Pass that name with `--session <name>` on **every** aisdlc command, so all steps land in one session log. At the start,
tell the engineer they can follow every step live in their own terminal with:

    aisdlc watch aisdlc-cleanup-<DD-MM-YYYY-HHmmss>

## Steps

1. **Repository.** If the engineer already has it pulled, run `aisdlc repo link <folder>`: it needs no approval, and
   the folder is only read. Otherwise ask for its https git URL and run `aisdlc repo add <url>`; a clone is the one
   thing that still needs the engineer's `aisdlc approve`. Stop until they have.
2. **Plan.** `aisdlc cleanup analyze <mirror> --session <name>`. Summarise the plan for the engineer in a few lines
   (gates before, findings per category, batches) and go on; do not wait.
3. **Work through the batches.** Hand this step to the `aisdlc-cleanup-batches` subagent when it is available, so the
   batch loop runs in a small context. Give it the run id, the session name, and the sections "How to fix a finding"
   and "Rules" below; it returns one line per batch, and stops early when a batch waits for the engineer (step 4).
   After step 4, hand the rest of the loop to it again. Without that subagent, do it yourself:
   1. `aisdlc cleanup next <run> --session <name>`, once. It prints the batch's findings with the code around each
      one, and the workspace folder. The first batch runs the formatters by itself; just run `check`.
   2. Read every file the batch names in one message, then make all of the batch's edits in one message. Edit only
      files inside the printed workspace, and fix exactly those findings.
   3. `aisdlc cleanup check <run> --session <name>`. Then:
      - **committed**: the output already shows the next batch; fix it (step 2). "Flagged for the PR reviewer" is
        information, not a stop.
      - **not committed**: the output lists what got worse and every finding of the batch that is still open, with
        "try k of 5". Fix all of them, whatever their severity, and check again.
      - **STOP, waits for the engineer**: the 5th try failed. Do not edit anything more. Go to step 4.
   Stop when the output says all batches are handled. `skip` also prints the next batch.
4. **Engineer's decision.** When a batch waits for the engineer, ask them with AskUserQuestion, naming the batch, its
   category and the findings still open:
   - **Retry**: run `aisdlc cleanup retry <run> --session <name>`. The batch gets 5 more tries, with its change kept.
     Go back to step 3.
   - **PR and issues**: run `aisdlc cleanup escalate <run> --session <name>`. It commits the batch's partial fix when it
     made nothing worse (or resets it), opens a GitHub issue for each finding left, and prints the next batch. Go
     back to step 3; when all batches are handled, go to step 5, which opens the PR.
   Run neither command before the engineer has answered, and run exactly the one they chose.
5. **Finish.** `aisdlc cleanup finish <run> --session <name>` pushes `cleanup/DD-MM-YYYY-HHmmss` and opens the pull request.
   Give the engineer the PR link and the top of its changelog and security concerns. If the push or the PR failed,
   run `finish` again: it retries from the push.

## How to fix a finding

- Keep behaviour the same. A test that passed before must pass after, and a new finding stops the batch.
- Make the smallest change that fixes the finding. Do not reformat or rename code the batch does not mention.
- Prefer clear names, small methods and classes with one responsibility. Inject dependencies instead of creating them,
  and depend on interfaces where a second implementation is realistic.
- Remove dead code instead of commenting it out.
- Never weaken a test to make it pass. Change or delete an existing test only when the test itself is wrong; the PR
  flags it, so say why in your summary.
- Fix secrets by moving them to configuration or the environment. Never print, copy or commit a secret's value.

## Rules

- A batch with SonarQube findings cannot be skipped; fix them. Only a batch without them may be skipped, with
  `aisdlc cleanup skip <run> --reason "<why>" --session <name>`, when its findings cannot be fixed without changing
  behaviour.
- Never try to get around the try count: the CLI keeps it, and the stop after the last try is the engineer's call.
  Never run `cleanup retry` or `cleanup escalate` on your own.
- Never run `approve` or `deny`. They are the engineer's decisions, and the CLI refuses them without an interactive
  terminal.
- Never push, open a PR, create branches, change git remotes, or commit in the workspace yourself. The CLI commits each
  batch that passes and pushes the one branch in `finish`.
- Edit only inside the workspace the CLI printed. Never edit the mirror, the aisdlc configuration, or `.aisdlc/`
  output.
