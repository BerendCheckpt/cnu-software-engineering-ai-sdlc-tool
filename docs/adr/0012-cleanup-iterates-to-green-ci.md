# ADR 0012: A clean-up iterates until the PR's CI is green; retries remember what failed

- **Status:** Accepted; extends ADR 0011
- **Date:** 2026-11-26

## Context
A clean-up ended at `finish`: the PR was opened and nobody looked at its CI. A check that only fails in CI (another
OS, a lint step aisdlc does not run) left a red PR for the engineer. A retry started from a clean slate, so the
model got no word of what it had already tried, and the engineer got no diagnosis when a batch waited. `finish`
also failed when the branch the run started from was gone on the remote.

## Decision
- **Base branch.** Before pushing, `finish` checks that the run's base branch is on the remote. When it is gone (or
  the workspace was on a detached HEAD), the PR goes into the remote's default branch; the run stores it and the
  output says so.
- **CI is read, never polled.** `cleanup ci <run>` reads the PR's checks once (`gh pr checks`). The CLI never waits;
  the skill waits for CI with the app's PR tools or `gh pr checks --watch`, then runs `cleanup ci`.
  - passing: the run records it; the clean-up is done.
  - pending, no checks, or not a GitHub PR: it says so and changes nothing.
  - failing: the failing checks, each with the tail of its failed log, become the findings of the run's one `ci`
    batch, which goes through the normal `next`/`check` loop. Locally a `ci` batch is committed when nothing got
    worse, because a CI failure cannot be re-measured on the host; the next `cleanup ci` is its real check.
    `finish` then pushes to the PR that is already open.
- **Same tries, same engineer.** Every failed CI round and every failed local check of the `ci` batch is a try on
  its fix loop. After `maxTries` the batch waits and the engineer chooses `retry` or `escalate`, as in ADR 0011.
  Once escalated, `cleanup ci` no longer reopens it.
- **Retries remember.** A retry starts the count again but keeps the earlier tries in `fix_loops`. Each failed check
  prints "Tried before" (what was still open, what got worse, which files changed) so the next try changes its
  approach, and a waiting batch comes with a diagnosis per finding for the engineer.

## Consequences
- An unattended run ends with a green PR, or with a batch waiting for the engineer; never silently red.
- CI rounds are slow (a push, then the whole pipeline), so each one costs a try.
- Only GitHub PRs are read; other hosts keep the manual step.
