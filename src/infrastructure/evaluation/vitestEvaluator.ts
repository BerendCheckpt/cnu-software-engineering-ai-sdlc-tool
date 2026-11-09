import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EvaluationResult } from "../../domain/evaluation.js";
import type { IEvaluator, IProcessRunner } from "../../ports/services.js";

interface VitestJson {
  numTotalTests: number;
  numFailedTests: number;
  testResults: { assertionResults: { fullName: string; status: string }[] }[];
}

/**
 * Runs the workspace's own Vitest with the JSON reporter. It calls `node` on Vitest's entry file instead of
 * `npx`, because `npx` is a `.cmd` on Windows and those only run through a shell.
 */
export class VitestEvaluator implements IEvaluator {
  readonly kind = "vitest" as const;

  constructor(private readonly runner: IProcessRunner) {}

  async evaluate(workspace: string): Promise<EvaluationResult> {
    // Angular runs Vitest through its own builder and setup, so the Angular gate covers it.
    if (existsSync(path.join(workspace, "angular.json"))) return EvaluationResult.skipped(this.kind, "Angular project: see the angular gate");
    const entry = path.join(workspace, "node_modules", "vitest", "vitest.mjs");
    if (!existsSync(entry)) return EvaluationResult.skipped(this.kind, "vitest is not installed in the workspace");

    const output = path.join(workspace, ".aisdlc", "vitest.json");
    const run = await this.runner.run(process.execPath, [entry, "run", "--reporter=json", `--outputFile=${output}`], workspace);
    if (!existsSync(output)) return new EvaluationResult(this.kind, false, `vitest produced no results: ${run.stderr.slice(-500)}`);

    const report = JSON.parse(readFileSync(output, "utf8")) as VitestJson;
    const failures = report.testResults
      .flatMap((r) => r.assertionResults)
      .filter((a) => a.status === "failed")
      .map((a) => a.fullName);
    const passed = report.numTotalTests - report.numFailedTests;
    const text = `${passed}/${report.numTotalTests} passed` + (failures.length ? `; failing: ${failures.slice(0, 5).join(", ")}` : "");
    return new EvaluationResult(this.kind, run.exitCode === 0 && report.numFailedTests === 0, text, output,
      { tests: { total: report.numTotalTests, failed: report.numFailedTests, failing: failures } });
  }
}
