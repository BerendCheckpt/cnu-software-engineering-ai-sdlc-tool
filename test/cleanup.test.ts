import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CleanupBatch, CleanupRun, ValidPr, type Finding, type Snapshot } from "../src/domain/cleanup.js";
import { CleanupPlanner } from "../src/domain/cleanupPlanner.js";
import { DiffClassifier } from "../src/domain/diffClassifier.js";
import { loadCleanupPolicy } from "../src/infrastructure/cleanup/yamlCleanupPolicy.js";
import { SonarClient } from "../src/infrastructure/evaluation/sonarClient.js";
import { NpmAuditSource } from "../src/infrastructure/findings/dependencyAuditSources.js";
import { GitleaksSource } from "../src/infrastructure/findings/gitleaksSource.js";
import { SonarIssueSource } from "../src/infrastructure/findings/sonarIssueSource.js";
import { ContainerProcessRunner, reachableFromContainer, toContainerPath } from "../src/infrastructure/process/containerProcessRunner.js";
import { RunnerCatalog } from "../src/infrastructure/process/runnerCatalog.js";
import type { IProcessRunner, ProcessResult } from "../src/ports/services.js";
import { tempDir } from "./helpers.js";

const policy = loadCleanupPolicy(path.resolve("config", "cleanup.yaml"));
const classifier = new DiffClassifier(policy.patterns);

function diffOf(file: string, lines: string[], mode?: "new" | "deleted"): string {
  return [
    `diff --git a/${file} b/${file}`,
    ...(mode === "new" ? ["new file mode 100644"] : mode === "deleted" ? ["deleted file mode 100644"] : []),
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1,3 +1,3 @@",
    ...lines,
  ].join("\n");
}

describe("DiffClassifier", () => {
  it("gates changing or deleting an existing test, but not adding one", () => {
    expect(classifier.classify(diffOf("src/Shop.Tests/OrderTests.cs", ["-    [Fact]"]), "maintainability"))
      .toEqual([{ gate: "tests", files: ["src/Shop.Tests/OrderTests.cs"] }]);
    expect(classifier.classify(diffOf("web/app.spec.ts", ["-it('works')"], "deleted"), "bug").map((g) => g.gate))
      .toEqual(["tests"]);
    expect(classifier.classify(diffOf("web/new.spec.ts", ["+it('works')"], "new"), "bug")).toEqual([]);
  });

  it("gates dependency files", () => {
    expect(classifier.classify(diffOf("package.json", ['-  "lodash": "4.17.20"', '+  "lodash": "4.17.21"']), "dependency")
      .map((g) => g.gate)).toEqual(["dependency"]);
    expect(classifier.classify(diffOf("src/Shop/Shop.csproj", ['+<PackageReference Include="X" />']), "maintainability")
      .map((g) => g.gate)).toEqual(["dependency"]);
  });

  it("gates security-sensitive paths, lines and security batches", () => {
    expect(classifier.classify(diffOf("src/AuthService.cs", ["-var x = 1;"]), "readability").map((g) => g.gate))
      .toEqual(["security"]);
    expect(classifier.classify(diffOf("src/Orders.cs", ["-    [Authorize]"]), "readability").map((g) => g.gate))
      .toEqual(["security"]);
    expect(classifier.classify(diffOf("src/Orders.cs", ["-var x = 1;"]), "security").map((g) => g.gate))
      .toEqual(["security"]);
  });

  it("does not gate dead code removal or a renamed public member", () => {
    const deadCode = diffOf("src/Orders.cs", ["-    private int Unused() => 42;", "-"]);
    const rename = diffOf("src/Orders.cs", ["-    public decimal Calc(Order o)", "+    public decimal CalculateTotal(Order o)"]);
    const exportRename = diffOf("web/price.ts", ["-export function calc(o: Order)", "+export function calculateTotal(o: Order)"]);
    expect(classifier.classify(deadCode, "maintainability")).toEqual([]);
    expect(classifier.classify(rename, "readability")).toEqual([]);
    expect(classifier.classify(exportRename, "readability")).toEqual([]);
  });
});

const finding = (file: string, line: number, category: Finding["category"] = "maintainability"): Finding =>
  ({ source: "sonar", rule: "S1", category, severity: "MAJOR", file, line, message: `issue at ${line}` });

describe("CleanupPlanner", () => {
  it("starts with the formatters, follows the category order and keeps batches small", () => {
    const planner = new CleanupPlanner({ maxFindings: 2, maxFiles: 1 }, ["security", "maintainability"]);
    const batches = planner.plan("r1", [
      finding("b.ts", 1), finding("a.ts", 2), finding("a.ts", 1), finding("a.ts", 3),
      finding("x.ts", 9, "security"), finding("ignored.ts", 1, "readability"),
    ]);
    expect(batches.map((b) => `${b.category}:${b.findings.map((f) => `${f.file}${f.line}`).join(",")}`)).toEqual([
      "format:", "security:x.ts9", "maintainability:a.ts1,a.ts2", "maintainability:a.ts3", "maintainability:b.ts1",
    ]);
    expect(batches.map((b) => b.number)).toEqual([0, 1, 2, 3, 4]);
  });
});

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  gates: [{ kind: "vitest", passed: true, skipped: false, tests: { total: 10, failed: 0, failing: [] } }],
  findings: [finding("a.ts", 1), finding("a.ts", 5)],
  ...overrides,
});

describe("ValidPr", () => {
  it("accepts an unchanged measurement, and a finding that only moved", () => {
    const moved = snapshot({ findings: [{ ...finding("a.ts", 1), line: 3 }, finding("a.ts", 5)] });
    expect(ValidPr.problems(snapshot(), moved, { fewerTestsApproved: false })).toEqual([]);
  });

  it("reports newly failing tests, a gate that stopped passing and a new finding", () => {
    const worse = snapshot({
      gates: [{ kind: "vitest", passed: false, skipped: false, tests: { total: 10, failed: 1, failing: ["adds"] } }],
      findings: [finding("a.ts", 1), finding("a.ts", 5), { ...finding("b.ts", 2), rule: "S2" }],
    });
    expect(ValidPr.problems(snapshot(), worse, { fewerTestsApproved: false })).toEqual([
      "vitest passed before and fails now", "vitest: newly failing adds", "new sonar finding S2 in b.ts:2",
    ]);
  });

  it("allows fewer tests only after a human approved it", () => {
    const fewer = snapshot({ gates: [{ kind: "vitest", passed: true, skipped: false, tests: { total: 8, failed: 0, failing: [] } }] });
    expect(ValidPr.problems(snapshot(), fewer, { fewerTestsApproved: false })).toEqual(["vitest: 2 fewer tests than before"]);
    expect(ValidPr.problems(snapshot(), fewer, { fewerTestsApproved: true })).toEqual([]);
  });

  it("reports lower coverage and a gate that no longer runs", () => {
    const before = snapshot({ gates: [{ kind: "sonar", passed: false, skipped: false, coverage: 80 },
      { kind: "xunit", passed: true, skipped: false }] });
    const after = snapshot({ gates: [{ kind: "sonar", passed: false, skipped: false, coverage: 79.5 },
      { kind: "xunit", passed: true, skipped: true }] });
    expect(ValidPr.problems(before, after, { fewerTestsApproved: false }))
      .toEqual(["sonar coverage went down from 80% to 79.5%", "xunit ran before but did not run now"]);
  });

  it("counts fixed findings", () => {
    expect(ValidPr.fixed(snapshot(), snapshot({ findings: [finding("a.ts", 5)] })).map((f) => f.line)).toEqual([1]);
  });
});

describe("CleanupRun and CleanupBatch", () => {
  it("only moves along its states", () => {
    const run = CleanupRun.start({ id: "r1", repository: "shop", workspace: "/w", branch: "b", baseBranch: "main", baseline: snapshot() });
    expect(() => run.moveTo("ready")).toThrow(/cannot go from analyzed to ready/);
    run.moveTo("accepted");
    run.moveTo("in-progress");
    run.moveTo("ready");
    run.published("https://github.com/o/r/pull/1");
    expect(run.state).toBe("pushed");
    expect(() => run.moveTo("abandoned")).toThrow();
  });

  it("needs a reason to skip and cannot complete a batch that is not open", () => {
    const batch = CleanupBatch.plan("r1", 1, "bug", []);
    expect(() => batch.complete("abc1234")).toThrow(/not in progress/);
    expect(() => batch.skip(" ")).toThrow(/reason/);
    batch.skip("not worth it");
    expect(() => batch.skip("again")).toThrow(/already skipped/);
  });
});

class RecordingRunner implements IProcessRunner {
  calls: { command: string; args: string[]; cwd: string }[] = [];
  constructor(private readonly result: Partial<ProcessResult> = {}, private readonly effect?: () => void) {}
  async run(command: string, args: string[], cwd: string): Promise<ProcessResult> {
    this.calls.push({ command, args, cwd });
    this.effect?.();
    return { exitCode: 0, stdout: "", stderr: "", ...this.result };
  }
}

describe("ContainerProcessRunner", () => {
  const catalog = new RunnerCatalog(path.resolve("config", "runners.yaml"));

  it("runs in a locked-down container with the workspace mounted, and passes secrets by name only", async () => {
    const workspace = tempDir();
    const host = new RecordingRunner();
    process.env.SONAR_TOKEN = "squ_do_not_leak";
    const runner = new ContainerProcessRunner(host, catalog, { network: "none", passEnvironment: ["SONAR_TOKEN"] });
    const output = path.join(workspace, ".aisdlc", "vitest.json");
    await runner.run(process.execPath, [path.join(workspace, "node_modules", "vitest", "vitest.mjs"), `--outputFile=${output}`], workspace);
    delete process.env.SONAR_TOKEN;

    const call = host.calls[0]!;
    expect(call.command).toBe("docker");
    expect(call.args).toEqual(expect.arrayContaining(["--rm", "--read-only", "--cap-drop", "ALL", "--entrypoint", "node"]));
    expect(call.args.slice(call.args.indexOf("--network"), call.args.indexOf("--network") + 2)).toEqual(["--network", "none"]);
    expect(call.args).toContain(`${path.resolve(workspace)}:/work`);
    expect(call.args.some((a) => a.startsWith("node:24.22.2-bookworm-slim@sha256:"))).toBe(true);
    expect(call.args.slice(-2)).toEqual(["/work/node_modules/vitest/vitest.mjs", "--outputFile=/work/.aisdlc/vitest.json"]);
    expect(call.args.join(" ")).not.toContain("squ_do_not_leak");
    expect(call.args[call.args.indexOf("SONAR_TOKEN") - 1]).toBe("--env");
  });

  it("picks the .NET SDK from the repository's TargetFramework", () => {
    const workspace = tempDir();
    mkdirSync(path.join(workspace, "src", "Shop"), { recursive: true });
    writeFileSync(path.join(workspace, "src", "Shop", "Shop.csproj"), "<Project><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>");
    const args = new ContainerProcessRunner(new RecordingRunner(), catalog, { network: "bridge" }).dockerArgs("dotnet", ["restore"], workspace);
    expect(args).toContain("mcr.microsoft.com/dotnet/sdk:9.0");
    expect(args).toContain("aisdlc-nuget:/root/.nuget/packages");
  });

  it("refuses to run without Docker", async () => {
    const runner = new ContainerProcessRunner(new RecordingRunner({ exitCode: 1 }), catalog, { network: "none" });
    await expect(runner.ensureAvailable()).rejects.toThrow(/Docker is not available/);
  });

  it("lets a container reach a server on this machine", () => {
    expect(reachableFromContainer("http://localhost:9000")).toBe("http://host.docker.internal:9000");
    expect(reachableFromContainer("https://sonar.example.com/")).toBe("https://sonar.example.com");
    const args = new ContainerProcessRunner(new RecordingRunner(), catalog, { network: "bridge", reachHost: true })
      .dockerArgs("sonar-scanner", [], tempDir());
    expect(args).toContain("host.docker.internal:host-gateway");
  });

  it("rewrites only paths inside the workspace", () => {
    const root = path.resolve(tempDir());
    expect(toContainerPath(path.join(root, "a", "b.json"), root)).toBe("/work/a/b.json");
    expect(toContainerPath(`${root}-other/x`, root)).toBe(`${root}-other/x`);
    expect(toContainerPath("--reporter=json", root)).toBe("--reporter=json");
  });
});

describe("finding sources", () => {
  it("maps SonarQube issues and hotspots to findings with repository paths", async () => {
    const http = (async (url: string) => {
      const body = String(url).includes("/api/issues/search")
        ? { issues: [{ rule: "ts:S1481", severity: "MINOR", type: "CODE_SMELL", component: "k:src/a.ts", line: 3, message: "unused" },
          { rule: "ts:S2259", severity: "MAJOR", type: "BUG", component: "k:src/b.ts", message: "null" }] }
        : { hotspots: [{ ruleKey: "ts:S2068", vulnerabilityProbability: "HIGH", component: "k:src/c.ts", line: 1, message: "password" }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const findings = await new SonarIssueSource(new SonarClient({ hostUrl: "https://sonar", token: "t" }, http), "k").collect();
    expect(findings.map((f) => `${f.category}:${f.file}:${f.line ?? "-"}`)).toEqual(
      ["readability:src/a.ts:3", "bug:src/b.ts:-", "security:src/c.ts:1"]);
  });

  it("records hotspots it may not read as a limitation instead of failing", async () => {
    const http = (async (url: string) => String(url).includes("/api/hotspots/")
      ? new Response("{}", { status: 403 })
      : new Response(JSON.stringify({ issues: [] }), { status: 200 })) as typeof fetch;
    const source = new SonarIssueSource(new SonarClient({ hostUrl: "https://sonar", token: "sqa_x" }, http), "k");
    expect(await source.collect()).toEqual([]);
    expect(source.limitations()).toEqual([expect.stringMatching(/hotspots were not read/)]);
  });

  it("keeps only where gitleaks found a secret, never the secret", async () => {
    const workspace = tempDir();
    mkdirSync(path.join(workspace, ".aisdlc"));
    const runner = new RecordingRunner({}, () => writeFileSync(path.join(workspace, ".aisdlc", "gitleaks.json"), JSON.stringify([
      { RuleID: "generic-api-key", Description: "Generic API Key", File: "/work/src/config.ts", StartLine: 4, Secret: "REDACTED" },
    ])));
    const findings = await new GitleaksSource(runner).collect(workspace);
    expect(findings).toEqual([{ source: "gitleaks", rule: "generic-api-key", category: "security", severity: "CRITICAL",
      file: "src/config.ts", line: 4, message: "Generic API Key" }]);
    expect(runner.calls[0]?.args).toContain("--redact");
  });

  it("reads npm audit output even though npm exits with 1", async () => {
    const workspace = tempDir();
    writeFileSync(path.join(workspace, "package-lock.json"), "{}");
    const stdout = JSON.stringify({ vulnerabilities: { lodash: { severity: "high", range: "<4.17.21", isDirect: true } } });
    const findings = await new NpmAuditSource(new RecordingRunner({ exitCode: 1, stdout })).collect(workspace);
    expect(findings.map((f) => `${f.category} ${f.severity} ${f.message}`)).toEqual(["dependency HIGH lodash <4.17.21 is vulnerable (high)"]);
  });
});
