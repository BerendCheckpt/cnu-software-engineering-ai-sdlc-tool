import { existsSync } from "node:fs";
import path from "node:path";
import { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { IEvaluator } from "../../../ports/interfaces/evaluation/IEvaluator.js";
import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";
import { testSummary } from "../../../shared/helpers/evaluation/testSummary.js";
import { isAngularWorkspace } from "../../../shared/helpers/workspace/isAngularWorkspace.js";
import { summarize } from "../../helpers/evaluation/summarize.js";

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
    if (!isAngularWorkspace(workspace)) return EvaluationResult.skipped(this.kind, "no angular.json");
    if (!existsSync(ng)) return EvaluationResult.skipped(this.kind, "@angular/cli is not installed in the workspace");

    const run = await this.runner.run(process.execPath, [ng, "test", "--watch=false"], workspace, TEST_TIMEOUT_MS);
    const output = `${run.stdout}\n${run.stderr}`.replace(ANSI, "");
    const tests = summarize(output);
    if (!tests) return new EvaluationResult(this.kind, false, `ng test produced no test summary: ${output.slice(-500)}`);
    return new EvaluationResult(this.kind, run.exitCode === 0 && tests.failed === 0, testSummary(tests), undefined, { tests });
  }
}
