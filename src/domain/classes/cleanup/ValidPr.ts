import { findingLocation } from "../../../shared/helpers/findings/findingLocation.js";
import { findingKey } from "../../helpers/cleanup/findingKey.js";
import type { ComparisonOptions } from "../../interfaces/cleanup/ComparisonOptions.js";
import type { Finding } from "../../interfaces/cleanup/Finding.js";
import type { GateSnapshot } from "../../interfaces/cleanup/GateSnapshot.js";
import type { Snapshot } from "../../interfaces/cleanup/Snapshot.js";

/**
 * Decides whether the workspace is still at least as good as a reference measurement. An empty list means it is;
 * otherwise each entry says what got worse. This is what "a valid PR" means in code.
 */
export class ValidPr {
  static problems(reference: Snapshot, current: Snapshot, options: ComparisonOptions): string[] {
    return [...this.gateProblems(reference, current, options), ...this.newFindings(reference, current)];
  }

  /** Findings that were open in the reference and are gone now. */
  static fixed(reference: Snapshot, current: Snapshot): Finding[] {
    return minus(reference.findings, current.findings);
  }

  private static gateProblems(reference: Snapshot, current: Snapshot, options: ComparisonOptions): string[] {
    const problems: string[] = [];
    for (const before of reference.gates.filter((g) => !g.skipped)) {
      const now = current.gates.find((g) => g.kind === before.kind);
      if (!now || now.skipped) {
        problems.push(`${before.kind} ran before but did not run now`);
        continue;
      }
      if (before.passed && !now.passed) problems.push(`${before.kind} passed before and fails now`);
      problems.push(...this.testProblems(before, now, options));
      if (before.coverage !== undefined && now.coverage !== undefined && now.coverage < before.coverage) {
        problems.push(`${before.kind} coverage went down from ${before.coverage}% to ${now.coverage}%`);
      }
    }
    return problems;
  }

  private static testProblems(before: GateSnapshot, now: GateSnapshot, options: ComparisonOptions): string[] {
    if (!before.tests || !now.tests) return [];
    const problems: string[] = [];
    const knownFailures = new Set(before.tests.failing);
    const newFailures = now.tests.failing.filter((t) => !knownFailures.has(t));
    if (newFailures.length) problems.push(`${before.kind}: newly failing ${newFailures.slice(0, 5).join(", ")}`);
    if (now.tests.total < before.tests.total && !options.fewerTestsApproved) {
      problems.push(`${before.kind}: ${before.tests.total - now.tests.total} fewer tests than before`);
    }
    return problems;
  }

  private static newFindings(reference: Snapshot, current: Snapshot): string[] {
    const added = minus(current.findings, reference.findings);
    return added.slice(0, 5).map((f) => `new ${f.source} finding ${f.rule} in ${findingLocation(f)}`)
      .concat(added.length > 5 ? [`and ${added.length - 5} more new findings`] : []);
  }
}

/** The findings of `from` that `remove` does not have, counting duplicates: two equal findings need two to cancel. */
function minus(from: Finding[], remove: Finding[]): Finding[] {
  const remaining = countByKey(remove);
  return from.filter((f) => {
    const left = remaining.get(findingKey(f)) ?? 0;
    if (left > 0) {
      remaining.set(findingKey(f), left - 1);
      return false;
    }
    return true;
  });
}

function countByKey(findings: Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(findingKey(f), (counts.get(findingKey(f)) ?? 0) + 1);
  return counts;
}
