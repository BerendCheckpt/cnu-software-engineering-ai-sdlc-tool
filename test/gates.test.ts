import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunEvaluations } from "../src/application/evaluation.js";
import { ProposeSolution } from "../src/application/solutionLifecycle.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import { AngularTestEvaluator, summarize } from "../src/infrastructure/evaluation/angularTestEvaluator.js";
import { SonarClient } from "../src/infrastructure/evaluation/sonarClient.js";
import { SonarScannerEvaluator } from "../src/infrastructure/evaluation/sonarScannerEvaluator.js";
import { VitestEvaluator } from "../src/infrastructure/evaluation/vitestEvaluator.js";
import { ContainerProcessRunner } from "../src/infrastructure/process/containerProcessRunner.js";
import { RunnerCatalog } from "../src/infrastructure/process/runnerCatalog.js";
import { openDatabase } from "../src/infrastructure/sqlite/database.js";
import { SqliteSolutionStore } from "../src/infrastructure/sqlite/sqliteSolutionStore.js";
import type { IProcessRunner, ProcessResult } from "../src/ports/services.js";
import { fixLoopFor, mirrorWithRemote, tempDir } from "./helpers.js";

class RecordingRunner implements IProcessRunner {
  calls: { command: string; args: string[] }[] = [];
  constructor(private readonly result: Partial<ProcessResult> = {}) {}
  async run(command: string, args: string[]): Promise<ProcessResult> {
    this.calls.push({ command, args });
    return { exitCode: 0, stdout: "", stderr: "", ...this.result };
  }
}

function angularWorkspace(): string {
  const workspace = tempDir();
  writeFileSync(path.join(workspace, "angular.json"), "{}");
  mkdirSync(path.join(workspace, "node_modules", "@angular", "cli", "bin"), { recursive: true });
  writeFileSync(path.join(workspace, "node_modules", "@angular", "cli", "bin", "ng.js"), "");
  return workspace;
}

describe("Angular test gate", () => {
  it("reads Vitest's summary, including the failing tests", () => {
    const output = [
      " \u001b[31mFAIL\u001b[39m  src/app/counter.spec.ts > CounterService > adds the numbers 12ms",
      " Test Files  1 failed | 3 passed (4)",
      "      Tests  1 failed | 11 passed (12)",
    ].join("\n").replace(/\u001b\[[0-9;]*m/g, "");
    expect(summarize(output)).toEqual({ total: 12, failed: 1, failing: ["src/app/counter.spec.ts > CounterService > adds the numbers"] });
    expect(summarize("      Tests  12 passed (12)")).toEqual({ total: 12, failed: 0, failing: [] });
    expect(summarize("no summary here")).toBeUndefined();
  });

  it("runs ng test once with the workspace's own CLI", async () => {
    const workspace = angularWorkspace();
    const runner = new RecordingRunner({ stdout: "      Tests  5 passed (5)\n" });
    const result = await new AngularTestEvaluator(runner).evaluate(workspace);
    expect(result).toMatchObject({ kind: "angular", passed: true, digest: "5/5 passed", metrics: { tests: { total: 5, failed: 0 } } });
    expect(runner.calls[0]?.args.slice(1)).toEqual(["test", "--watch=false"]);
    expect(runner.calls[0]?.args[0]).toContain(path.join("@angular", "cli", "bin", "ng.js"));
  });

  it("skips projects that are not Angular, and leaves Angular's Vitest to the Angular gate", async () => {
    expect((await new AngularTestEvaluator(new RecordingRunner()).evaluate(tempDir())).isSkipped).toBe(true);
    const result = await new VitestEvaluator(new RecordingRunner()).evaluate(angularWorkspace());
    expect(result.digest).toMatch(/skipped: Angular project/);
  });
});

describe("SonarQube for .NET", () => {
  const client = new SonarClient({ hostUrl: "http://localhost:9000", token: "t" }, (async () =>
    new Response(JSON.stringify({ projectStatus: { status: "OK" }, component: { measures: [] } }), { status: 200 })) as typeof fetch);

  it("scans a .NET repository with begin, build and end in the .NET scanner image", async () => {
    const workspace = tempDir();
    writeFileSync(path.join(workspace, "Counter.slnx"), "<Solution />");
    const runner = new RecordingRunner();
    const result = await new SonarScannerEvaluator(runner, client, "aisdlc-solution-x").evaluate(workspace);
    expect(runner.calls).toEqual([{ command: "scan-dotnet", args: ["aisdlc-solution-x", "http://host.docker.internal:9000"] }]);
    expect(result.passed).toBe(true);
  });

  it("runs the scan script in the locally built image, with a writable home", () => {
    const catalog = new RunnerCatalog(path.resolve("config", "runners.yaml"));
    const args = new ContainerProcessRunner(new RecordingRunner(), catalog, { network: "bridge", passEnvironment: ["SONAR_TOKEN"] })
      .dockerArgs("scan-dotnet", ["k", "u"], tempDir());
    expect(args).toEqual(expect.arrayContaining(["aisdlc/dotnet-sonar:1", "HOME=/tmp", "--entrypoint", "scan-dotnet"]));
  });
});

describe("RunEvaluations in a sandbox", () => {
  it("checks the sandbox and restores packages before any gate, with gates made for the solution", async () => {
    const store = new SqliteSolutionStore(openDatabase(":memory:"));
    const solution = new ProposeSolution(store).execute("migrate", "Migrate", "");
    const order: string[] = [];
    const gate = { kind: "xunit" as const, evaluate: async () => { order.push("gate"); return new EvaluationResult("xunit", true, "1/1 passed"); } };
    const environment = {
      sandbox: { ensureAvailable: async () => { order.push("sandbox"); } },
      restorer: { restore: async () => { order.push("restore"); } },
    };
    let madeFor = "";
    await new RunEvaluations(tempDir(), store, (id) => { madeFor = id; return { evaluators: [gate], findingSources: [] }; }, environment,
      fixLoopFor(), mirrorWithRemote()).execute(solution.id, "shop");
    expect(order).toEqual(["sandbox", "restore", "gate"]);
    expect(madeFor).toBe(solution.id);
  });
});
