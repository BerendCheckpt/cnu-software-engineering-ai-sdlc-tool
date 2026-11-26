import type { FixAttempt } from "../../../domain/interfaces/quality/FixAttempt.js";
import { where } from "./where.js";

/** One line per earlier failed try: what was still open, what got worse, which files the change touched. */
export function triedBefore(failed: FixAttempt[]): string[] {
  return failed.map((a, i) => [
    `try ${i + 1}:`,
    [
      a.blocking.length ? `still open ${a.blocking.map(where).join(", ")}` : "",
      ...a.problems,
      // A CI round is not a local check, so it has no files of its own.
      a.changed?.length ? `changed ${a.changed.join(", ")}` : "",
    ].filter(Boolean).join("; "),
  ].join(" "));
}
