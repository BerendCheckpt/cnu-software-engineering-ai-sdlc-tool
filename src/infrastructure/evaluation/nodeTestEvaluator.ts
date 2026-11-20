import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EvaluationResult } from "../../domain/evaluation.js";
import type { IEvaluator, IProcessRunner } from "../../ports/services.js";

/** Counts from the node:test spec or TAP summary ("ℹ tests 12" / "# tests 12", and the same for fail). */
export function summarizeNodeTest(output: string): { total: number; failed: number; failing: string[] } | undefined {
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

/**
 * Runs a Node project's own `test` script when it uses the built-in test runner (`node --test`).
 * It calls `node --run test` instead of `npm test`, because `npm` is a `.cmd` on Windows and those only
 * run through a shell. Projects on Vitest or Angular are left to those gates.
 */
export class NodeTestEvaluator implements IEvaluator {
  readonly kind = "node-test" as const;

  constructor(private readonly runner: IProcessRunner) {}

  async evaluate(workspace: string): Promise<EvaluationResult> {
    const manifest = path.join(workspace, "package.json");
    if (!existsSync(manifest)) return EvaluationResult.skipped(this.kind, "no package.json");
    if (existsSync(path.join(workspace, "angular.json"))) return EvaluationResult.skipped(this.kind, "Angular project: see the angular gate");
    const script = (JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> }).scripts?.test ?? "";
    if (!/\bnode\b[^&|;]*--test\b/.test(script)) return EvaluationResult.skipped(this.kind, "the test script does not use node --test");

    const run = await this.runner.run(process.execPath, ["--run", "test"], workspace);
    const output = `${run.stdout}\n${run.stderr}`;
    const summary = summarizeNodeTest(output);
    if (!summary) return new EvaluationResult(this.kind, false, `node --test produced no summary: ${output.slice(-500)}`);

    const passed = summary.total - summary.failed;
    const text = `${passed}/${summary.total} passed` + (summary.failing.length ? `; failing: ${summary.failing.slice(0, 5).join(", ")}` : "");
    return new EvaluationResult(this.kind, run.exitCode === 0 && summary.failed === 0, text, undefined, { tests: summary });
  }
}
