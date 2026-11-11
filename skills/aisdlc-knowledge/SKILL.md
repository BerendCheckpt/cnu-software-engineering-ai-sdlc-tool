---
name: aisdlc-knowledge
description: Look up solutions, tests and migrations that CheckNet engineers already evaluated and accepted, before writing new code. Use when starting a coding task, planning a change, asking "has someone solved this before", "where was this applied", searching the local .NET/C#/Angular/xUnit/Vitest/TypeScript docs, or planning a .NET 9 to 10 or JavaScript to TypeScript migration.
---

# aisdlc knowledge

The `aisdlc` CLI holds solutions that engineers accepted after they passed xUnit, Vitest and SonarQube, plus where each
was applied, a local copy of the official docs, and read-only mirrors of repositories. Check it **before** writing
code: reusing an accepted solution costs nothing and has already been reviewed.

Run commands as `node "$AISDLC_HOME/dist/adapters/cli/main.js" <command>` (or `aisdlc <command>` when it is linked).
Output is short by design. Do not read the knowledge database or the mirrors directly.

## Before a coding task

1. `aisdlc lookup "<the task in one sentence>"`
   - **An accepted solution exists**: show it to the engineer with its test results and where it was applied, then
     ask whether it fits. Do not re-implement it.
     - It fits: `aisdlc accept <id> --prompt "<task>"` adds it to their implementation plan.
     - It does not fit: `aisdlc reject <id> --prompt "<task>" --reason "<their words>"`. The output is a short brief;
       work out a solution from that brief together with the engineer.
   - **No confident match**: the output is a brief with the closest candidates. Use it as context and ask the
     engineer one clarifying question if anything is ambiguous.

## Documentation

- `aisdlc docs search "<question>" [--framework dotnet|csharp|angular|xunit|vitest|typescript]`
- `aisdlc docs list` shows what is downloaded (`[x]`) and what is not.
- Missing docs: `aisdlc docs request <id>` creates a request. **Never approve it yourself**; tell the engineer to run
  `aisdlc approve <approval-id>`.

## Migrations

`aisdlc migrate --from net9 --to net10 --repo <mirror>` (or `--from js --to ts`). Act on what it says:
- a crystallized skill exists: use that skill;
- docs are missing: show the engineer the approval commands, and stop;
- the repository is not mirrored: if the engineer has it pulled, `aisdlc repo link <folder>` (no approval needed);
  otherwise ask for its git URL, then `aisdlc repo add <url>`, and stop until they approve;
- escalated: tell the engineer there is no official documentation for this migration, and do not attempt it;
- delegated to an agent (only `--from ckp-retailerplugin --to cnu-retailerplugin`, a legacy retailer plugin): do not
  plan or convert it yourself; tell the engineer to run the named agent (`cnu:shiva`) for that retailer;
- a plan: summarise the plan file for the engineer.

## Evaluating your solution

1. `aisdlc propose --prompt "<task>" --summary "<one line>" --diff-file <file>` saves it as a draft.
2. `aisdlc eval <id> --repo <mirror>` runs the tests and SonarQube in containers.
   - **Blocking issues** (BLOCKER, HIGH) must be fixed, including issues that were there before your change.
     **Other issues** (MEDIUM) should be fixed too, but do not block.
   - Fix them, then `aisdlc revise <id> --diff-file <file>` with the whole new diff, and `eval` again.
   - After the first check and three fix attempts fail, the CLI opens a GitHub issue for a human and the solution is
     escalated. Stop there and give the engineer the link; only they can `reopen` it.
3. Once it is evaluated, tell the engineer they can accept it with `aisdlc solution-accept <id>`.

## Rules

- Approvals, accepting solutions, crystallizing and reopening an escalated solution are human decisions. `approve` and `deny` only run in the
  engineer's own terminal; tell them the command. Never run `solution-accept` unless the engineer explicitly asks you
  to in this conversation.
- Code you write follows OOP and SOLID, and starts as the minimal implementation.
