import type { TestCounts } from "../../../domain/interfaces/evaluation/TestCounts.js";

/** Reads Vitest's `Tests  1 failed | 4 passed (5)` line and its `FAIL  file > suite > test` lines. */
export function summarize(output: string): TestCounts | undefined {
  const line = /^\s*Tests\s+(.*\(\d+\))\s*$/m.exec(output)?.[1];
  if (!line) return undefined;
  const count = (label: string) => Number(new RegExp(`(\\d+) ${label}`).exec(line)?.[1] ?? 0);
  const failing = [...output.matchAll(/^\s*(?:FAIL|×)\s+(.+?)\s*(?:\d+ms)?$/gm)]
    .map((m) => m[1]!.trim())
    .filter((name, i, all) => all.indexOf(name) === i);
  return { total: Number(/\((\d+)\)/.exec(line)![1]), failed: count("failed"), failing };
}
