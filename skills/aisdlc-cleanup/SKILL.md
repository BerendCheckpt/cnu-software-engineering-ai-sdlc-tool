---
name: aisdlc-cleanup
description: Clean up a repository so its code is readable, maintainable, secure and up to quality standards, ending in a pull request. Plan first, batch by batch, with human gates for tests, dependencies and security-sensitive code. Use when an engineer asks to "clean up", "tidy", "refactor for quality", "fix the Sonar issues" or "make this repo maintainable", or wants a quality PR for a repository.
---

# aisdlc clean-up

The `aisdlc` CLI measures a repository and turns what it finds into a plan of small batches. It checks every batch you
make and opens the PR only when a human allows it:
- **Measuring.** Builds, tests, the SonarQube scan, gitleaks and the dependency audits all run in throw-away Docker
  containers.
- **The plan.** The findings are split into small batches, ordered security, bugs, dependencies, maintainability,
  readability.
- **Checking each batch.** The whole repository is measured again and compared with the last accepted measurement.
  Changes to existing tests, dependencies or security-sensitive code go to a human.
- **The PR.** It is opened only after a human approves the push.

Your job is the part in the middle: fix the findings of one batch at a time.

Run commands as `node "$AISDLC_HOME/dist/adapters/cli/main.js" <command>` (or `aisdlc <command>` when it is linked).
Output is short by design; act on what it says.

## Steps

1. **Repository.** If the engineer already has it pulled, run `aisdlc repo link <folder>`: it needs no approval, and
   the folder is only read. Otherwise ask for its https git URL and run `aisdlc repo add <url>`, and stop until they
   approve the clone.
2. **Plan.** Run `aisdlc cleanup analyze <mirror>`. Summarise the plan file for the engineer (gates before, findings
   per category, batches). Tell them to run `aisdlc approve <approval-id>` in their own terminal. Stop until they
   have.
3. **Work through the batches.** Repeat until `next` says all batches are handled:
   1. `aisdlc cleanup next <run>`. It prints the batch's findings with the code around each one, and the workspace
      folder. The first batch runs the formatters by itself; just run `check`.
   2. Fix exactly those findings, editing only files inside the printed workspace.
   3. `aisdlc cleanup check <run>`. Then:
      - **committed**: go to the next batch.
      - **not committed**: the output lists what got worse and the blocking SonarQube issues (BLOCKER, HIGH) of the
        batch that are still open, with "fix attempt k of N". Fix them and check again.
      - **escalated**: the batch failed too often. Its change was reset and a GitHub issue was opened for a human.
        Tell the engineer the link, then go on with `next`.
      - **needs a human**: tell the engineer which gate and which files. Stop until they have approved or denied.
4. **Finish.** `aisdlc cleanup finish <run>` writes the PR description. Show it to the engineer, and tell them to run
   `aisdlc approve <approval-id>` to push and open the pull request.

## How to fix a finding

- Keep behaviour the same. A test that passed before must pass after, and a new finding stops the batch.
- Make the smallest change that fixes the finding. Do not reformat or rename code the batch does not mention.
- Prefer clear names, small methods and classes with one responsibility. Inject dependencies instead of creating them,
  and depend on interfaces where a second implementation is realistic.
- Remove dead code instead of commenting it out. Removing dead code and renaming public members need no human gate.
- Never weaken a test to make it pass. Changing or deleting an existing test needs a human, so do it only when the
  test itself is wrong, and say why.
- Fix secrets by moving them to configuration or the environment. Never print, copy or commit a secret's value.

## Rules

- A batch with blocking SonarQube issues cannot be skipped; fix them. Only a batch without them may be skipped, with
  `aisdlc cleanup skip <run> --reason "<why>"`, when its findings cannot be fixed without changing behaviour.
- Never try to get around the attempt count: the CLI keeps it, and the escalation is the engineer's signal.

- Never run `approve` or `deny`. They are the engineer's decisions, and the CLI refuses them without an interactive
  terminal.
- Never push, open a PR, change git remotes, or commit in the workspace yourself. The CLI commits each batch that
  passes, and pushes only after a human approved it.
- Edit only inside the workspace the CLI printed. Never edit the mirror, the aisdlc configuration, or
  `.aisdlc/` output.
- Stop whenever a batch waits for a human, and say what they need to decide.
