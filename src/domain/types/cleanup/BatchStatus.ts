/**
 * `waiting`: findings were still open after the last allowed try; the engineer decides to retry or escalate.
 * `escalated`: the engineer chose a PR with issues for the findings left; a change that made nothing worse is committed.
 */
export type BatchStatus = "pending" | "in-progress" | "waiting" | "done" | "skipped" | "escalated";
