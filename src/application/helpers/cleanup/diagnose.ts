import { findingKey } from "../../../domain/helpers/cleanup/findingKey.js";
import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import type { FixAttempt } from "../../../domain/interfaces/quality/FixAttempt.js";
import { where } from "./where.js";

/** Why a batch waits, per finding left: how often it stayed open, or what else got worse. Decided without a model. */
export function diagnose(failed: FixAttempt[]): string[] {
  const last = failed.at(-1);
  if (!last) return [];
  const touched = [...new Set(failed.flatMap((a) => a.changed ?? []))];
  // A CI check's log differs per round; its name is what identifies it.
  const key = (f: Finding) => (f.source === "ci" ? `ci|${f.rule}` : findingKey(f));
  const lines = last.blocking.map((f) => {
    const openIn = failed.filter((a) => a.blocking.some((b) => key(b) === key(f))).length;
    const file = f.file && !touched.includes(f.file) ? `; its file ${f.file} was never changed` : "";
    return `${where(f)}: still open in ${openIn} of ${failed.length} tries${file}`;
  });
  if (last.problems.length) {
    lines.push(last.blocking.length
      ? `Also got worse: ${last.problems.join("; ")}`
      : `Every finding is fixed, but something else got worse: ${last.problems.join("; ")}`);
  }
  if (touched.length) lines.push(`Files changed over the tries: ${touched.join(", ")}`);
  return lines;
}
