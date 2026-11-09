import { CleanupBatch, type Finding, type FindingCategory } from "./cleanup.js";

export interface BatchLimits {
  maxFindings: number;
  maxFiles: number;
}

/**
 * Turns findings into small batches: first the formatters (no model), then one category at a time in the given
 * order. A batch closes when it would hold more findings or touch more files than the limits allow, so every diff
 * stays small enough to review.
 */
export class CleanupPlanner {
  constructor(private readonly limits: BatchLimits, private readonly order: readonly FindingCategory[]) {}

  plan(runId: string, findings: Finding[]): CleanupBatch[] {
    const batches = [CleanupBatch.plan(runId, 0, "format", [])];
    for (const category of this.order) {
      const inCategory = findings
        .filter((f) => f.category === category)
        .sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
      for (const group of this.split(inCategory)) {
        batches.push(CleanupBatch.plan(runId, batches.length, category, group));
      }
    }
    return batches;
  }

  private split(findings: Finding[]): Finding[][] {
    const groups: Finding[][] = [];
    let current: Finding[] = [];
    let files = new Set<string>();
    for (const finding of findings) {
      const wouldTouch = files.has(finding.file) ? files.size : files.size + 1;
      if (current.length >= this.limits.maxFindings || wouldTouch > this.limits.maxFiles) {
        groups.push(current);
        current = [];
        files = new Set();
      }
      current.push(finding);
      files.add(finding.file);
    }
    if (current.length) groups.push(current);
    return groups;
  }
}
