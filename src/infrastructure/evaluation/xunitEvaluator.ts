import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { EvaluationResult, type TestCounts } from "../../domain/evaluation.js";
import type { IEvaluator, IProcessRunner } from "../../ports/services.js";

const SOLUTION_OR_PROJECT = /\.(slnx?|csproj)$/i;

/** Runs `dotnet test` with the TRX logger and reports the counters and the first failing tests. */
export class XunitEvaluator implements IEvaluator {
  readonly kind = "xunit" as const;

  constructor(private readonly runner: IProcessRunner) {}

  async evaluate(workspace: string): Promise<EvaluationResult> {
    if (!readdirSync(workspace).some((f) => SOLUTION_OR_PROJECT.test(f))) {
      return EvaluationResult.skipped(this.kind, "no .sln, .slnx or .csproj at the workspace root");
    }
    const results = path.join(workspace, ".aisdlc", "xunit");
    const run = await this.runner.run(
      "dotnet", ["test", "--logger", "trx", "--results-directory", results], workspace);
    const summary = this.summarize(results);
    if (!summary) return new EvaluationResult(this.kind, false, `dotnet test produced no results: ${run.stderr.slice(-500)}`);
    return new EvaluationResult(this.kind, run.exitCode === 0 && summary.tests.failed === 0, summary.text, results,
      { tests: summary.tests });
  }

  private summarize(directory: string): { tests: TestCounts; text: string } | undefined {
    let files: string[];
    try {
      files = readdirSync(directory).filter((f) => f.endsWith(".trx"));
    } catch {
      return undefined;
    }
    if (!files.length) return undefined;
    let total = 0;
    let failed = 0;
    const failures: string[] = [];
    for (const file of files) {
      const trx = readFileSync(path.join(directory, file), "utf8");
      const counters = /<Counters\b[^>]*\btotal="(\d+)"[^>]*\bfailed="(\d+)"/.exec(trx);
      total += Number(counters?.[1] ?? 0);
      failed += Number(counters?.[2] ?? 0);
      for (const m of trx.matchAll(/<UnitTestResult\b[^>]*\btestName="([^"]+)"[^>]*\boutcome="Failed"/g)) {
        failures.push(m[1]!);
      }
    }
    const text = `${total - failed}/${total} passed` + (failures.length ? `; failing: ${failures.slice(0, 5).join(", ")}` : "");
    return { tests: { total, failed, failing: failures }, text };
  }
}
