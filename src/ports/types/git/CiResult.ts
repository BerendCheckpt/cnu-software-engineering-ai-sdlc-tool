import type { FailedCheck } from "../../interfaces/git/FailedCheck.js";

/**
 * The CI result of a pull request, read once. `none`: no checks are reported; `unsupported`: not a GitHub pull
 * request, so it cannot be read.
 */
export type CiResult =
  | { state: "passing" | "pending" | "none" }
  | { state: "unsupported"; reason: string }
  | { state: "failing"; failing: FailedCheck[] };
