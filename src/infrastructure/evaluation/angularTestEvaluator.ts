import { existsSync } from "node:fs";
import path from "node:path";
import { EvaluationResult } from "../../domain/evaluation.js";
import type { IEvaluator, IProcessRunner } from "../../ports/services.js";

const ANSI = /\u001b\[[0-9;]*m/g;
const TEST_TIMEOUT_MS = 15 * 60_000;

/**
 * Runs `ng test --watch=false` with the workspace's own Angular CLI, so the project's own test builder and settings
 * apply (Vitest by default since Angular 21). Counts come from the runner's summary line.
 */
export class AngularTestEvaluator implements IEvaluator {
  readonly kind = "angular" as const;

  constructor(private readonly runner: IProcessRunner) {}

  async evaluate(workspace: string): Promise<EvaluationResult> {
    const ng = path.join(workspace, "node_modules", "@angular", "cli", "bin", "ng.js");
    if (!existsSync(path.join(workspace, "angular.json"))) return EvaluationResult.skipped(this.kind, "no angular.json");
    if (!existsSync(ng)) return EvaluationResult.skipped(this.kind, "@angular/cli is not installed in the workspace");

    const run = await this.runner.run(process.execPath, [ng, "test", "--watch=false"], workspace, TEST_TIMEOUT_MS);
    const output = `${run.stdout}\n${run.stderr}`.replace(ANSI, "");
    const tests = summarize(output);
    if (!tests) return new EvaluationResult(this.kind, false, `ng test produced no test summary: ${output.slice(-500)}`);
    const text = `${tests.total - tests.failed}/${tests.total} passed` +
      (tests.failing.length ? `; failing: ${tests.failing.slice(0, 5).join(", ")}` : "");
    return new EvaluationResult(this.kind, run.exitCode === 0 && tests.failed === 0, text, undefined, { tests });
  }
}

/** Reads Vitest's `Tests  1 failed | 4 passed (5)` line and its `FAIL  file > suite > test` lines. */
export function summarize(output: string): { total: number; failed: number; failing: string[] } | undefined {
  const line = /^\s*Tests\s+(.*\(\d+\))\s*$/m.exec(output)?.[1];
  if (!line) return undefined;
  const count = (label: string) => Number(new RegExp(`(\\d+) ${label}`).exec(line)?.[1] ?? 0);
  const failing = [...output.matchAll(/^\s*(?:FAIL|×)\s+(.+?)\s*(?:\d+ms)?$/gm)]
    .map((m) => m[1]!.trim())
    .filter((name, i, all) => all.indexOf(name) === i);
  return { total: Number(/\((\d+)\)/.exec(line)![1]), failed: count("failed"), failing };
}
