import { writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ReopenSolution, ReviseSolution, RunEvaluations } from "../src/application/evaluation.js";
import { ProposeSolution } from "../src/application/solutionLifecycle.js";
import type { Finding } from "../src/domain/cleanup.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import { FixLoop, normalizeSeverity, QualityPolicy } from "../src/domain/quality.js";
import { SonarClient } from "../src/infrastructure/evaluation/sonarClient.js";
import { SonarIssueSource } from "../src/infrastructure/findings/sonarIssueSource.js";
import { GhIssueTracker } from "../src/infrastructure/git/ghIssueTracker.js";
import { gitHubRepository, hostOf } from "../src/infrastructure/git/remotes.js";
import { loadQualityPolicy } from "../src/infrastructure/quality/yamlQualityPolicy.js";
import { EscalationReportWriter } from "../src/infrastructure/reporting/escalationReportWriter.js";
import { openDatabase } from "../src/infrastructure/sqlite/database.js";
import { SqliteFixLoopStore } from "../src/infrastructure/sqlite/sqliteFixLoopStore.js";
import { SqliteSolutionStore } from "../src/infrastructure/sqlite/sqliteSolutionStore.js";
import type { IFindingSource, IIssueTracker, IProcessRunner, ProcessResult } from "../src/ports/services.js";
import { FakeIssueTracker, fixLoopFor, mirrorWithRemote, tempDir } from "./helpers.js";

const issue = (severity: string, rule = "S1", file = "src/a.ts", source = "sonar"): Finding =>
  ({ source, rule, category: "security", severity, file, line: 1, message: `${rule} in ${file}` });

const policy = new QualityPolicy(["blocker", "High"], ["MEDIUM"], 3);
const attempt = (blocking: Finding[], problems: string[] = []) =>
  ({ at: "2026-11-05T10:00:00Z", blocking, reported: [], problems });

describe("severities and the quality policy", () => {
  it("maps old SonarQube severities to impact severities, case-insensitively", () => {
    expect(["blocker", "CRITICAL", "Major", "minor", "INFO", "HIGH", "odd"].map(normalizeSeverity))
      .toEqual(["BLOCKER", "HIGH", "MEDIUM", "LOW", "INFO", "HIGH", "INFO"]);
  });

  it("blocks on BLOCKER and HIGH SonarQube issues only, and reports MEDIUM", () => {
    const findings = [issue("CRITICAL"), issue("MEDIUM", "S2"), issue("LOW", "S3"), issue("HIGH", "leak", "x", "gitleaks")];
    expect(policy.blocking(findings).map((f) => f.rule)).toEqual(["S1"]);
    expect(policy.reported(findings).map((f) => f.rule)).toEqual(["S2"]);
  });

  it("reads config/quality.yaml, and uses the defaults without it", () => {
    const shipped = loadQualityPolicy(path.resolve("config", "quality.yaml"));
    expect(shipped.maxFixAttempts).toBe(3);
    expect(shipped.blocking([issue("MEDIUM")])).toEqual([]);
    expect(loadQualityPolicy(path.join(tempDir(), "missing.yaml")).blocking([issue("HIGH")])).toHaveLength(1);

    const file = path.join(tempDir(), "quality.yaml");
    writeFileSync(file, "sonar:\n  blockingSeverities: [BLOCKER, HIGH, MEDIUM]\n  maxFixAttempts: 1\n");
    const strict = loadQualityPolicy(file);
    expect([strict.maxFixAttempts, strict.blocking([issue("MAJOR")]).length]).toEqual([1, 1]);
    writeFileSync(file, "sonar:\n  maxFixAttempts: -1\n");
    expect(() => loadQualityPolicy(file)).toThrow();
  });

  it("takes the most severe impact of an issue, or its old severity on older servers", async () => {
    const http = (async (url: string) => new Response(JSON.stringify(url.includes("/api/issues/")
      ? { issues: [
        { rule: "S1", severity: "MAJOR", type: "CODE_SMELL", component: "k:src/a.ts", message: "m",
          impacts: [{ softwareQuality: "MAINTAINABILITY", severity: "LOW" }, { softwareQuality: "SECURITY", severity: "HIGH" }] },
        { rule: "S2", severity: "CRITICAL", type: "BUG", component: "k:src/b.ts", message: "m" },
      ] }
      : { hotspots: [] }))) as typeof fetch;
    const findings = await new SonarIssueSource(new SonarClient({ hostUrl: "http://sonar", token: "t" }, http), "k").collect();
    expect(findings.map((f) => `${f.rule}:${f.severity}`)).toEqual(["S1:HIGH", "S2:HIGH"]);
  });
});

describe("FixLoop", () => {
  it("allows the first check and three fix attempts to fail, and escalates the next failure", () => {
    const loop = FixLoop.start("solution:1");
    const verdicts = [1, 2, 3, 4].map(() => loop.record(attempt([issue("HIGH")]), policy).kind);
    expect(verdicts).toEqual(["fix-required", "fix-required", "fix-required", "escalate"]);
    loop.escalated("https://github.com/org/shop/issues/1");
    expect(() => loop.record(attempt([]), policy)).toThrow(/escalated/);

    loop.reopen();
    expect([loop.state, loop.attempts.length]).toEqual(["open", 0]);
    expect(() => loop.reopen()).toThrow(/not escalated/);
  });

  it("is clean when nothing blocks and nothing else failed, and counts only failed checks", () => {
    const loop = FixLoop.start("cleanup:r#1");
    expect(loop.record(attempt([], ["vitest failed"]), policy)).toEqual({ kind: "fix-required", failures: 1, maxFixAttempts: 3 });
    expect(loop.record(attempt([]), policy).kind).toBe("clean");
    expect([loop.state, loop.failures]).toEqual(["clean", 1]);
  });

  it("is kept in SQLite", () => {
    const store = new SqliteFixLoopStore(openDatabase(":memory:"));
    const loop = FixLoop.start("solution:9");
    loop.record(attempt([issue("BLOCKER")]), policy);
    store.save(loop);
    expect(store.get("solution:9")?.toProps()).toEqual(loop.toProps());
    expect(store.get("solution:0")).toBeUndefined();
  });
});

describe("escalation", () => {
  class Runner implements IProcessRunner {
    calls: string[][] = [];
    constructor(private readonly result: Partial<ProcessResult> = {}) {}
    async run(command: string, args: string[]): Promise<ProcessResult> {
      this.calls.push([command, ...args]);
      return { exitCode: 0, stdout: "Creating issue\nhttps://github.com/org/shop/issues/12\n", stderr: "", ...this.result };
    }
  }

  it("knows GitHub remotes over https and ssh", () => {
    expect(gitHubRepository("https://github.com/org/shop.git")).toBe("org/shop");
    expect(gitHubRepository("git@github.com:org/shop.git")).toBe("org/shop");
    expect(gitHubRepository("https://dev.azure.com/org/p/_git/shop")).toBeUndefined();
    expect(hostOf("C:/remotes/shop.git")).toBeUndefined();
  });

  it("opens the issue with gh in the working repository", async () => {
    const runner = new Runner();
    const url = await new GhIssueTracker(runner, tempDir()).open("https://github.com/org/shop.git", "title", "body.md");
    expect(url).toBe("https://github.com/org/shop/issues/12");
    expect(runner.calls[0]).toEqual(["gh", "issue", "create", "--repo", "org/shop", "--title", "title", "--body-file", "body.md"]);
  });

  it("says where the text is when the repository is not on GitHub or gh fails", async () => {
    const runner = new Runner({ exitCode: 1, stderr: "not logged in" });
    const tracker = new GhIssueTracker(runner, tempDir());
    expect(await tracker.open("C:/remotes/shop.git", "t", "body.md")).toMatch(/Not a GitHub repository.*body\.md/);
    expect(await tracker.open(undefined, "t", "body.md")).toMatch(/by hand/);
    expect(await tracker.open("https://github.com/org/shop", "t", "body.md")).toMatch(/gh issue create failed \(not logged in\).*body\.md/);
  });

  it("writes an issue a human can pick up at once, without secrets", () => {
    const loop = FixLoop.start("solution:1");
    loop.record({ ...attempt([issue("HIGH", "S2068"), issue("HIGH", "S4502")]), reported: [issue("MEDIUM", "S3")] }, policy);
    loop.record(attempt([issue("HIGH", "S2068"), issue("HIGH", "S5131")], ["vitest failed: 1/2 passed"]), policy);
    const { title, body } = new EscalationReportWriter().render({
      task: "solution 1: Counter on .NET 10", details: ["Request: migrate"], repository: "shop",
      remoteUrl: "https://github.com/org/shop.git", location: ["Workspace: C:/work/1"],
      sonarProjectUrl: "http://localhost:9000/project/issues?id=aisdlc-solution-1&resolved=false",
      diff: "--- a/x\n+++ b/x\n", reproduce: "aisdlc eval 1 --repo shop", limitations: ["hotspots were not read"],
    }, loop, 3);

    expect(title).toBe("aisdlc: 2 SonarQube issues still open after 3 fix attempts: solution 1: Counter on .NET 10");
    expect(body).toContain("| HIGH | [S2068](http://localhost:9000/coding_rules?open=S2068) | `src/a.ts:1` |");
    expect(body).toContain("| 2 | 2026-11-05T10:00:00Z | 2 | S4502 src/a.ts | S5131 src/a.ts | vitest failed: 1/2 passed |");
    for (const part of ["https://github.com/org/shop.git", "aisdlc eval 1 --repo shop", "hotspots were not read", "```diff", "aisdlc reopen"]) {
      expect(body).toContain(part);
    }
    expect(body).not.toMatch(/token|sqa_/i);
  });
});

describe("the fix loop of a solution", () => {
  let store: SqliteSolutionStore;
  let work: string;
  let open: Finding[];
  let tracker: IIssueTracker & { opened?: unknown[] };

  const sonar: IFindingSource = { name: "sonar", collect: async () => open };
  const passing = { kind: "xunit" as const, evaluate: async () => new EvaluationResult("xunit", true, "2/2 passed") };
  const ON_HOST = { sandbox: { ensureAvailable: async () => {} }, restorer: { restore: async () => {} } };

  beforeEach(() => {
    store = new SqliteSolutionStore(openDatabase(":memory:"));
    work = tempDir();
    tracker = new FakeIssueTracker();
  });

  const setup = (fixLoop = fixLoopFor({ tracker })) => ({
    fixLoop,
    evaluate: new RunEvaluations(work, store, () => ({ evaluators: [passing], findingSources: [sonar] }), ON_HOST, fixLoop,
      mirrorWithRemote("https://github.com/org/shop.git")),
  });

  it("asks for a fix while a blocking issue is open, never blocks on MEDIUM, and evaluates a clean revision", async () => {
    const { evaluate } = setup();
    const solution = new ProposeSolution(store).execute("migrate", "Migrate", "diff 1");
    open = [issue("HIGH", "S2068"), issue("MEDIUM", "S3")];

    const first = await evaluate.execute(solution.id, "shop");
    expect(first.loop).toEqual({ kind: "fix-required", failures: 1, maxFixAttempts: 3 });
    expect([first.blocking.map((b) => b.finding.rule), first.reported.map((r) => r.finding.rule)]).toEqual([["S2068"], ["S3"]]);
    expect(store.get(solution.id)?.state).toBe("draft");

    new ReviseSolution(work, store).execute(solution.id, "diff 2");
    open = [issue("MEDIUM", "S3")];
    const second = await evaluate.execute(solution.id, "shop");
    expect(second.loop.kind).toBe("clean");
    expect(second.reported).toHaveLength(1);
    expect(store.get(solution.id)?.state).toBe("evaluated");
    expect(store.get(solution.id)?.diff).toBe("diff 2");
    expect(() => new ReviseSolution(work, store).execute(solution.id, "diff 3")).toThrow(/Only a draft/);
  });

  it("escalates the fourth failure to a GitHub issue, then refuses until a human reopens it", async () => {
    const { evaluate, fixLoop } = setup();
    const solution = new ProposeSolution(store).execute("migrate", "Migrate", "diff");
    open = [issue("BLOCKER")];
    for (let i = 0; i < 3; i++) expect((await evaluate.execute(solution.id, "shop")).loop.kind).toBe("fix-required");

    const fourth = await evaluate.execute(solution.id, "shop");
    expect(fourth.loop).toEqual({ kind: "escalated", failures: 4, where: "https://github.com/org/shop/issues/1" });
    expect(store.get(solution.id)?.state).toBe("escalated");
    const opened = (tracker as FakeIssueTracker).opened;
    expect(opened).toHaveLength(1);
    expect(opened[0]?.remoteUrl).toBe("https://github.com/org/shop.git");
    expect(opened[0]?.body).toContain(`aisdlc eval ${solution.id} --repo shop`);
    await expect(evaluate.execute(solution.id, "shop")).rejects.toThrow(/escalated to a human.*aisdlc reopen/);

    new ReopenSolution(store, fixLoop).execute(solution.id);
    expect(store.get(solution.id)?.state).toBe("draft");
    open = [];
    expect((await evaluate.execute(solution.id, "shop")).loop.kind).toBe("clean");
  });

  it("still escalates, with a note, when the issue cannot be opened", async () => {
    const failing: IIssueTracker = { open: async () => { throw new Error("gh is not installed"); } };
    const { evaluate } = setup(fixLoopFor({ tracker: failing, maxFixAttempts: 0 }));
    const solution = new ProposeSolution(store).execute("migrate", "Migrate", "diff");
    open = [issue("HIGH")];
    const outcome = await evaluate.execute(solution.id, "shop");
    expect(outcome.loop.kind).toBe("escalated");
    expect(outcome.loop.kind === "escalated" && outcome.loop.where).toMatch(/could not be opened: gh is not installed.*\.md/);
    expect(store.get(solution.id)?.state).toBe("escalated");
  });

  it("counts a failing gate, and an unreadable SonarQube, as a failed check", async () => {
    const solution = new ProposeSolution(store).execute("migrate", "Migrate", "diff");
    const broken: IFindingSource = { name: "sonar", collect: async () => { throw new Error("401"); } };
    const evaluate = new RunEvaluations(work, store, () => ({ evaluators: [passing], findingSources: [broken] }), ON_HOST,
      fixLoopFor(), mirrorWithRemote());
    const outcome = await evaluate.execute(solution.id, "shop");
    expect(outcome.loop.kind).toBe("fix-required");
    expect(outcome.problems).toEqual(["SonarQube issues could not be read: 401"]);
  });
});
