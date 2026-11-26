import type { TestCounts } from "../../../domain/interfaces/evaluation/TestCounts.js";

/** Counts from the node:test spec or TAP summary ("ℹ tests 12" / "# tests 12", and the same for fail). */
export function summarizeNodeTest(output: string): TestCounts | undefined {
  const count = (name: string) => {
    const m = new RegExp(`^(?:ℹ|#) ${name} (\\d+)\\s*$`, "m").exec(output);
    return m ? Number(m[1]) : undefined;
  };
  const total = count("tests");
  const failed = count("fail");
  if (total === undefined || failed === undefined) return undefined;
  const failing = [...output.matchAll(/^\s*(?:✖|not ok \d+ -) (.+?)(?: \([\d.]+m?s\))?\s*$/gm)]
    .map((m) => m[1]!.trim())
    .filter((name, i, all) => name !== "failing tests:" && all.indexOf(name) === i);
  return { total, failed, failing };
}
