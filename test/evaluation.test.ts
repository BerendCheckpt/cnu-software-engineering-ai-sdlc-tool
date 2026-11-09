import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PrepareWorkspace, RunEvaluations, WriteReport } from "../src/application/evaluation.js";
import { ProposeSolution } from "../src/application/solutionLifecycle.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import { SonarEvaluator } from "../src/infrastructure/evaluation/sonarEvaluator.js";
import { VitestEvaluator } from "../src/infrastructure/evaluation/vitestEvaluator.js";
import { XunitEvaluator } from "../src/infrastructure/evaluation/xunitEvaluator.js";
import { GitRepoMirror } from "../src/infrastructure/git/gitRepoMirror.js";
import { ExecFileRunner } from "../src/infrastructure/process/execFileRunner.js";
import { MarkdownReportWriter } from "../src/infrastructure/reporting/markdownReportWriter.js";
import { openDatabase } from "../src/infrastructure/sqlite/database.js";
import { SqliteSolutionStore } from "../src/infrastructure/sqlite/sqliteSolutionStore.js";
import type { IEvaluator, IProcessRunner, ProcessResult } from "../src/ports/services.js";
import { fixLoopFor, gitRepo, mirrorWithRemote, tempDir } from "./helpers.js";

/** Records calls and writes what the real tool would have written. */
class FakeRunner implements IProcessRunner {
  calls: string[][] = [];
  constructor(private readonly effect: (args: string[], cwd: string) => void, private readonly exitCode = 0) {}
  async run(command: string, args: string[], cwd: string): Promise<ProcessResult> {
    this.calls.push([command, ...args]);
    this.effect(args, cwd);
    return { exitCode: this.exitCode, stdout: "", stderr: "" };
  }
}

/** No containers in these tests: the evaluators are fakes. */
const ON_HOST = { sandbox: { ensureAvailable: async () => {} }, restorer: { restore: async () => {} } };

class SlowEvaluator implements IEvaluator {
  static running = 0;
  static maxConcurrent = 0;
  constructor(readonly kind: "xunit" | "vitest" | "sonar", private readonly passed = true) {}
  async evaluate(): Promise<EvaluationResult> {
    SlowEvaluator.running++;
    SlowEvaluator.maxConcurrent = Math.max(SlowEvaluator.maxConcurrent, SlowEvaluator.running);
    await new Promise((r) => setTimeout(r, 20));
    SlowEvaluator.running--;
    return new EvaluationResult(this.kind, this.passed, `${this.kind} done`);
  }
}

describe("RunEvaluations", () => {
  let store: SqliteSolutionStore;
  let work: string;

  beforeEach(() => {
    store = new SqliteSolutionStore(openDatabase(":memory:"));
    work = tempDir();
    SlowEvaluator.maxConcurrent = 0;
  });

  const evaluate = async (evaluators: IEvaluator[], id: string) =>
    (await new RunEvaluations(work, store, () => ({ evaluators, findingSources: [] }), ON_HOST, fixLoopFor(), mirrorWithRemote())
      .execute(id, "shop")).results;

  it("runs the gates in parallel and marks a passing draft as evaluated", async () => {
    const solution = new ProposeSolution(store).execute("add endpoint", "Endpoint", "");
    const evaluators = [new SlowEvaluator("xunit"), new SlowEvaluator("vitest"), new SlowEvaluator("sonar")];
    const results = await evaluate(evaluators, solution.id);

    expect(SlowEvaluator.maxConcurrent).toBe(3);
    expect(results.map((r) => r.kind)).toEqual(["xunit", "vitest", "sonar"]);
    expect(store.get(solution.id)?.state).toBe("evaluated");
  });

  it("keeps a draft a draft when one gate fails, and a broken gate does not hide the others", async () => {
    const solution = new ProposeSolution(store).execute("add endpoint", "Endpoint", "");
    const broken: IEvaluator = { kind: "sonar", evaluate: async () => { throw new Error("server down"); } };
    const results = await evaluate([new SlowEvaluator("xunit"), broken], solution.id);

    expect(results[1]?.digest).toBe("error: server down");
    expect(store.get(solution.id)?.state).toBe("draft");
  });

  it("does not count a run where every gate was skipped as a pass", async () => {
    const solution = new ProposeSolution(store).execute("add endpoint", "Endpoint", "");
    const skipped: IEvaluator = { kind: "sonar", evaluate: async () => EvaluationResult.skipped("sonar", "no config") };
    await evaluate([skipped], solution.id);
    expect(store.get(solution.id)?.state).toBe("draft");
  });

  it("writes a PR report with one row per gate", async () => {
    const solution = new ProposeSolution(store).execute("add endpoint", "Orders endpoint", "");
    await evaluate([new SlowEvaluator("xunit"), new SlowEvaluator("vitest", false)], solution.id);
    const report = new WriteReport(work, store, new MarkdownReportWriter()).execute(solution.id, "Adds the endpoint.");

    expect(readFileSync(report.path, "utf8")).toBe(report.markdown);
    expect(report.markdown).toContain("| xunit | passed | xunit done |");
    expect(report.markdown).toContain("| vitest | **failed** | vitest done |");
    expect(report.markdown).toContain("A human reviews this change");
  });

  it("prepares a workspace with the solution's diff applied", async () => {
    const mirrors = tempDir();
    gitRepo(mirrors, "shop-api", { "README.md": "old\n" });
    const diff = "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n";
    const solution = new ProposeSolution(store).execute("update readme", "Readme", diff);

    const workspace = await new PrepareWorkspace(work, store, new GitRepoMirror(mirrors, new ExecFileRunner()))
      .execute(solution.id, "shop-api");
    expect(readFileSync(path.join(workspace, "README.md"), "utf8").replace(/\r\n/g, "\n")).toBe("new\n");
  });
});

describe("XunitEvaluator", () => {
  const trx = (total: number, failed: number, failing: string[] = []) => `<TestRun>
    ${failing.map((n) => `<UnitTestResult testName="${n}" outcome="Failed" />`).join("")}
    <ResultSummary><Counters total="${total}" executed="${total}" passed="${total - failed}" failed="${failed}" /></ResultSummary>
  </TestRun>`;

  function workspaceWithResults(content: string): { workspace: string; runner: FakeRunner } {
    const workspace = tempDir();
    writeFileSync(path.join(workspace, "Shop.slnx"), "");
    const runner = new FakeRunner((args) => {
      const dir = args[args.indexOf("--results-directory") + 1]!;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "run.trx"), content);
    });
    return { workspace, runner };
  }

  it("reports counters and failing tests from the TRX file", async () => {
    const { workspace, runner } = workspaceWithResults(trx(3, 1, ["Orders_RejectsEmptyName"]));
    const result = await new XunitEvaluator(runner).evaluate(workspace);
    expect(result.passed).toBe(false);
    expect(result.digest).toBe("2/3 passed; failing: Orders_RejectsEmptyName");
    expect(runner.calls[0]?.slice(0, 4)).toEqual(["dotnet", "test", "--logger", "trx"]);
  });

  it("passes when every test passed", async () => {
    const { workspace, runner } = workspaceWithResults(trx(4, 0));
    expect((await new XunitEvaluator(runner).evaluate(workspace)).digest).toBe("4/4 passed");
  });

  it("skips a workspace without a .NET solution", async () => {
    const result = await new XunitEvaluator(new FakeRunner(() => {})).evaluate(tempDir());
    expect(result.isSkipped).toBe(true);
  });
});

describe("VitestEvaluator", () => {
  it("reports failing tests from the JSON reporter", async () => {
    const workspace = tempDir();
    mkdirSync(path.join(workspace, "node_modules", "vitest"), { recursive: true });
    writeFileSync(path.join(workspace, "node_modules", "vitest", "vitest.mjs"), "");
    const runner = new FakeRunner((args) => {
      const output = args.find((a) => a.startsWith("--outputFile="))!.slice("--outputFile=".length);
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify({
        numTotalTests: 2,
        numFailedTests: 1,
        testResults: [{ assertionResults: [
          { fullName: "OrderList shows orders", status: "passed" },
          { fullName: "OrderList filters by date", status: "failed" },
        ] }],
      }));
    }, 1);

    const result = await new VitestEvaluator(runner).evaluate(workspace);
    expect(result.passed).toBe(false);
    expect(result.digest).toBe("1/2 passed; failing: OrderList filters by date");
  });

  it("skips a workspace without vitest", async () => {
    expect((await new VitestEvaluator(new FakeRunner(() => {})).evaluate(tempDir())).isSkipped).toBe(true);
  });
});

describe("SonarEvaluator", () => {
  function workspaceWithKey(): string {
    const workspace = tempDir();
    writeFileSync(path.join(workspace, "sonar-project.properties"), "sonar.projectKey=shop-api\n");
    return workspace;
  }

  it("reads the quality gate and measures with the token as a bearer header", async () => {
    const seen: { url: string; auth: string }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: (init.headers as Record<string, string>).Authorization! });
      const body = url.includes("qualitygates")
        ? { projectStatus: { status: "ERROR" } }
        : { component: { measures: [{ metric: "bugs", value: "2" }] } };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;

    const result = await new SonarEvaluator({ hostUrl: "https://sonar.example", token: "secret" }, http).evaluate(workspaceWithKey());
    expect(result.passed).toBe(false);
    expect(result.digest).toBe("quality gate ERROR; bugs=2");
    expect(result.digest).not.toContain("secret");
    expect(seen.every((s) => s.auth === "Bearer secret")).toBe(true);
  });

  it("skips when the server is not configured", async () => {
    expect((await new SonarEvaluator({}).evaluate(workspaceWithKey())).isSkipped).toBe(true);
  });

  it("skips a workspace without a project key", async () => {
    const result = await new SonarEvaluator({ hostUrl: "https://sonar.example", token: "t" }).evaluate(tempDir());
    expect(result.isSkipped).toBe(true);
  });
});
