import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dispatch, parse } from "../src/adapters/cli/dispatch.js";
import { type App, appPaths, createApp } from "../src/adapters/composition.js";
import type { Finding } from "../src/domain/cleanup.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import { timeStamp } from "../src/domain/progress.js";
import { GhCiChecks } from "../src/infrastructure/git/ghCiChecks.js";
import { GitWorkspace } from "../src/infrastructure/git/gitWorkspace.js";
import { ExecFileRunner } from "../src/infrastructure/process/execFileRunner.js";
import type {
  CiResult, CleanupGates, ICiChecks, ICleanupGateFactory, IFormatter, IProcessRunner, IPullRequestPublisher, ISandbox,
} from "../src/ports/services.js";
import { FakeIssueTracker, gitRepo, tempDir } from "./helpers.js";

/** Stands in for Vitest: every `it("…")` is a test, and one whose line says BROKEN fails. */
const fakeVitest = {
  kind: "vitest" as const,
  async evaluate(workspace: string) {
    const lines = readFileSync(path.join(workspace, "test", "calc.test.ts"), "utf8").split("\n").filter((l) => l.includes('it("'));
    const failing = lines.filter((l) => l.includes("BROKEN")).map((l) => /it\("([^"]+)"/.exec(l)![1]!);
    return new EvaluationResult("vitest", failing.length === 0, `${lines.length - failing.length}/${lines.length} passed`, undefined,
      { tests: { total: lines.length, failed: failing.length, failing } });
  },
};

/** Stands in for SonarQube: every TODO in `src/` is a maintainability finding. */
const todoSource = {
  name: "todo",
  async collect(workspace: string): Promise<Finding[]> {
    const src = path.join(workspace, "src");
    return readdirSync(src).flatMap((file) => readFileSync(path.join(src, file), "utf8").split("\n")
      .flatMap((line, i) => line.includes("TODO")
        ? [{ source: "todo", rule: "todo", category: "maintainability" as const, severity: line.includes("mul") ? "CRITICAL" : "MAJOR",
          file: `src/${file}`, line: i + 1, message: line.trim() }]
        : []));
  },
};

class FakeGates implements ICleanupGateFactory {
  forRun(): CleanupGates {
    return { evaluators: [fakeVitest], findingSources: [todoSource], release: async () => undefined };
  }
}

class Sandbox implements ISandbox {
  available = true;
  async ensureAvailable() {
    if (!this.available) throw new Error("Docker is not available.");
  }
}

/** Removes trailing spaces, like a formatter would. */
const trimmer: IFormatter = {
  name: "trim",
  async apply(workspace) {
    const file = path.join(workspace, "src", "calc.ts");
    writeFileSync(file, readFileSync(file, "utf8").replace(/ +$/gm, ""));
    return true;
  },
};

class FakePublisher implements IPullRequestPublisher {
  opened: string[] = [];
  bases: string[] = [];
  async open(_workspace: string, branch: string, baseBranch: string) {
    this.opened.push(branch);
    this.bases.push(baseBranch);
    return "https://github.com/org/shop/pull/7";
  }
}

/** Hands out the CI results a test lines up, one per read. */
class FakeCiChecks implements ICiChecks {
  results: CiResult[] = [];
  async read(): Promise<CiResult> {
    const next = this.results.shift();
    if (!next) throw new Error("no CI result lined up");
    return next;
  }
}

const CALC = [
  "export const add = (a: number, b: number) => a + b; // TODO rename  ",
  "export const sub = (a: number, b: number) => a - b; // TODO rename",
  "export const mul = (a: number, b: number) => a * b; // TODO rename",
  "",
].join("\n");

const TESTS = ['it("adds", () => {});', 'it("subtracts", () => {});', 'it("multiplies", () => {});', ""].join("\n");

describe("clean-up flow", () => {
  let app: App;
  let home: string;
  let remote: string;
  let mirror: string;
  let sandbox: Sandbox;
  let publisher: FakePublisher;
  let ci: FakeCiChecks;
  let tracker: FakeIssueTracker;
  const now = new Date(2026, 10, 9, 14, 30, 5);
  const branch = `cleanup/${timeStamp(now)}`;

  beforeAll(() => {
    for (const role of ["AUTHOR", "COMMITTER"]) {
      process.env[`GIT_${role}_NAME`] = "test";
      process.env[`GIT_${role}_EMAIL`] = "test@example.com";
    }
  });

  beforeEach(() => {
    home = tempDir();
    cpSync(path.resolve("config"), path.join(home, "config"), { recursive: true });
    // One finding per batch, so the flow passes through several batches.
    const policy = path.join(home, "config", "cleanup.yaml");
    writeFileSync(policy, readFileSync(policy, "utf8").replace("maxFindings: 10", "maxFindings: 1"));

    remote = path.join(home, "remote.git");
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    mirror = gitRepo(path.join(home, "mirrors"), "shop", { "src/calc.ts": CALC, "test/calc.test.ts": TESTS });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: mirror });

    sandbox = new Sandbox();
    publisher = new FakePublisher();
    ci = new FakeCiChecks();
    tracker = new FakeIssueTracker();
    app = createApp(appPaths(home), {
      cleanup: { sandbox, restorer: { restore: async () => {} }, gates: new FakeGates(), formatters: [trimmer], publisher, ci },
      issueTracker: tracker,
    });
  });

  afterEach(() => app.close());

  const edit = (runWorkspace: string, file: string, change: (text: string) => string) => {
    const target = path.join(runWorkspace, file);
    writeFileSync(target, change(readFileSync(target, "utf8")));
  };

  it("runs every batch without a human, flags gated changes, and ends in a PR ranked by severity", async () => {
    const analysis = await app.cleanup.analyze.execute("shop", undefined, now);
    const { run } = analysis;
    expect(run.branch).toBe(branch);
    expect(analysis.batches.map((b) => b.category)).toEqual(["format", "maintainability", "maintainability", "maintainability"]);
    expect(readFileSync(analysis.planPath, "utf8")).toContain("## Automode");
    expect(app.approvals.open()).toEqual([]);

    // Batch 0: the formatters, no model.
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("formatted");
    expect((await app.cleanup.check.execute(run.id)).kind).toBe("committed");

    // Batch 1: a plain fix is committed straight away.
    const work = await app.cleanup.next.execute(run.id);
    if (work.kind !== "work") throw new Error(work.kind);
    expect(work.findings[0]?.code).toContain("1: export const add");
    edit(run.workspace, "src/calc.ts", (t) => t.replace("a + b; // TODO rename", "a + b;"));
    expect(await app.cleanup.check.execute(run.id)).toMatchObject({ kind: "committed", fixed: 1 });

    // Batch 2: breaking a test is a regression; deleting one is committed and flagged for the reviewer.
    await app.cleanup.next.execute(run.id);
    edit(run.workspace, "src/calc.ts", (t) => t.replace("a - b; // TODO rename", "a - b;"));
    edit(run.workspace, "test/calc.test.ts", (t) => t.replace('it("adds", () => {});', 'it("adds", () => {}); // BROKEN'));
    expect(await app.cleanup.check.execute(run.id)).toMatchObject({ kind: "regression", problems: ["vitest passed before and fails now", "vitest: newly failing adds"] });

    edit(run.workspace, "test/calc.test.ts", (t) => t.replace(" // BROKEN", "").replace(/it\("multiplies".*\r?\n/, ""));
    const gated = await app.cleanup.check.execute(run.id);
    if (gated.kind !== "committed") throw new Error(gated.kind);
    expect(gated.batch.gates).toEqual([{ gate: "tests", files: ["test/calc.test.ts"] }]);
    expect(app.approvals.open()).toEqual([]);

    // Batch 3: the CRITICAL finding.
    await app.cleanup.next.execute(run.id);
    edit(run.workspace, "src/calc.ts", (t) => t.replace("a * b; // TODO rename", "a * b;"));
    expect((await app.cleanup.check.execute(run.id)).kind).toBe("committed");
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("finished");

    // The branch the run started from is not on the remote; its default branch `trunk` is.
    execFileSync("git", ["push", "--quiet", "origin", "HEAD:refs/heads/trunk"], { cwd: mirror });
    execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/trunk"], { cwd: remote });

    // Finish: the PR body, the push of the one branch and the PR, with no approval in between.
    const finished = await app.cleanup.finish.execute(run.id);
    expect(finished.pullRequest).toBe("https://github.com/org/shop/pull/7");
    expect(publisher.opened).toEqual([branch]);
    expect(publisher.bases).toEqual(["trunk"]);
    expect(finished.note).toMatch(/is not on the remote; the pull request goes into its default branch trunk/);
    expect(app.cleanup.status.execute(run.id).run.baseBranch).toBe("trunk");
    expect(execFileSync("git", ["branch", "--list", branch], { cwd: remote, encoding: "utf8" }).trim()).toBe(branch);
    expect(execFileSync("git", ["log", "--format=%s", branch], { cwd: remote, encoding: "utf8" }))
      .toMatch(/batch 3 \(maintainability\)[\s\S]*batch 2 \(maintainability\)[\s\S]*batch 1 \(maintainability\)[\s\S]*formatters/);

    const report = readFileSync(finished.reportPath, "utf8");
    expect(report).toContain("3 of 3 findings fixed");
    expect(report).toContain(`Branch \`${branch}\` into \`trunk\`.`);
    const changelog = report.slice(report.indexOf("### Changelog"), report.indexOf("### Security concerns"));
    expect(changelog.split("\n").filter((l) => l.startsWith("| HIGH") || l.startsWith("| MEDIUM")).map((l) => l.slice(2, 8)))
      .toEqual(["HIGH |", "MEDIUM", "MEDIUM"]);
    expect(changelog).toMatch(/src\/calc\.ts:2` \| `[0-9a-f]{8}` ⚠/);
    expect(report).toContain("Review these changes closely");
    expect(report).toContain("tests: `test/calc.test.ts`");

    expect(app.cleanup.status.execute(run.id).run.state).toBe("pushed");
    await expect(app.cleanup.finish.execute(run.id)).rejects.toThrow(/pushed/);
    await expect(app.cleanup.analyze.execute("shop", undefined, now)).rejects.toThrow(/already ran on shop as branch/);
    const later = await app.cleanup.analyze.execute("shop", undefined, new Date(now.getTime() + 60_000));
    expect(later.run.branch).not.toBe(branch);
  }, 30_000);

  it("refuses a branch that already exists in the repository or on the remote", async () => {
    execFileSync("git", ["branch", branch], { cwd: mirror });
    await expect(app.cleanup.analyze.execute("shop", undefined, now)).rejects.toThrow(/already exists in the repository/);

    execFileSync("git", ["push", "--quiet", "origin", `${branch}:${branch}`], { cwd: mirror });
    execFileSync("git", ["branch", "-D", branch], { cwd: mirror });
    await expect(app.cleanup.analyze.execute("shop", undefined, now)).rejects.toThrow(/already exists on the remote/);
  });

  it("reports every step to the named session and to its log", async () => {
    const { command, args } = parse(["cleanup", "analyze", "shop", "--session", "aisdlc-cleanup-09-11-2026"]);
    const result = await dispatch(app, command!, args, undefined);
    expect(result.text).toMatch(/^session: aisdlc-cleanup-09-11-2026 \(follow it with: aisdlc watch aisdlc-cleanup-09-11-2026\)/);
    const { events } = app.sessionLog.read("aisdlc-cleanup-09-11-2026");
    expect(events.map((e) => `${e.step} ${e.status}`)).toEqual(expect.arrayContaining(
      ["checkout started", "checkout done", "gate vitest done", "findings done", "plan done"]));
    expect(events.every((e) => e.session === "aisdlc-cleanup-09-11-2026")).toBe(true);
  });

  it("names the session after the command and the run when none is given, and logs a failure", async () => {
    const analyzed = await dispatch(app, "cleanup", parse(["cleanup", "analyze", "shop"]).args, undefined);
    const runId = analyzed.remember?.run;
    const session = analyzed.text.split("\n")[0]!.match(/^session: (\S+) /)![1]!;
    expect(session).toMatch(new RegExp(`^cleanup-${runId}-\\d{2}-\\d{2}-\\d{4}-\\d{6}$`));
    expect(analyzed.text.split("\n")[0]).toBe(`session: ${session} (follow it with: aisdlc watch ${session})`);
    expect(app.sessionLog.latest()).toBe(session);

    await expect(dispatch(app, "cleanup", parse(["cleanup", "check", runId!]).args, undefined)).rejects.toThrow();
    expect(app.sessionLog.read(session).events.at(-1)).toMatchObject({ step: "cleanup", status: "failed" });
  });

  it("keeps tool output out of commits and refuses to start without Docker", async () => {
    sandbox.available = false;
    await expect(app.cleanup.analyze.execute("shop")).rejects.toThrow(/Docker is not available/);
    sandbox.available = true;

    const { run } = await app.cleanup.analyze.execute("shop");
    await app.cleanup.next.execute(run.id);
    writeFileSync(path.join(run.workspace, ".aisdlc", "vitest.json"), "{}");
    await app.cleanup.check.execute(run.id);
    const files = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: run.workspace, encoding: "utf8" });
    expect(files.trim()).toBe("src/calc.ts");
    expect(existsSync(path.join(run.workspace, ".aisdlc", "vitest.json"))).toBe(true);
  });

  it("starts the next batch from the CLI as soon as check commits or skip throws a batch away", async () => {
    const cli = async (...words: string[]) => (await dispatch(app, "cleanup", parse(["cleanup", ...words]).args, undefined)).text;
    const runId = (await dispatch(app, "cleanup", parse(["cleanup", "analyze", "shop"]).args, undefined)).remember!.run!;
    const workspace = app.cleanup.status.execute(runId).run.workspace;

    await cli("next", runId);
    const afterFormat = await cli("check", runId);
    expect(afterFormat).toContain("Batch 0 committed");
    expect(afterFormat).toMatch(/Batch 1 \(maintainability\), 1 findings[\s\S]*src\/calc\.ts:1[\s\S]*When done: aisdlc cleanup check/);
    expect(afterFormat).not.toContain(`Next: aisdlc cleanup next ${runId}`);

    edit(workspace, "src/calc.ts", (t) => t.replace("add", "plus"));
    const afterSkip = await cli("skip", runId, "--reason", "needs a product decision");
    expect(afterSkip).toMatch(/^[\s\S]*Batch 1 skipped\.\nBatch 2 \(maintainability\)/);

    edit(workspace, "src/calc.ts", (t) => t.replace("a - b; // TODO rename", "a - b;"));
    expect(await cli("check", runId)).toContain("Batch 3 (maintainability)");
    edit(workspace, "src/calc.ts", (t) => t.replace("a * b; // TODO rename", "a * b;"));
    expect(await cli("check", runId)).toContain(`All batches are handled. Next: aisdlc cleanup finish ${runId}`);
  }, 30_000);

  /** A run with every batch fixed and its PR opened. */
  const pushedRun = async () => {
    const { run } = await app.cleanup.analyze.execute("shop");
    await app.cleanup.next.execute(run.id);
    await app.cleanup.check.execute(run.id);
    for (const op of ["+", "-", "*"]) {
      await app.cleanup.next.execute(run.id);
      edit(run.workspace, "src/calc.ts", (t) => t.replace(`a ${op} b; // TODO rename`, `a ${op} b;`));
      expect((await app.cleanup.check.execute(run.id)).kind).toBe("committed");
    }
    await app.cleanup.finish.execute(run.id);
    return run;
  };
  const failing = (log: string): CiResult => ({ state: "failing", failing: [{ name: "build", log }] });

  it("iterates until the PR's CI is green: a failing check becomes the ci batch, and finish pushes to the open PR", async () => {
    const run = await pushedRun();
    const cli = async (...words: string[]) => (await dispatch(app, "cleanup", parse(["cleanup", ...words]).args, undefined)).text;

    ci.results.push({ state: "pending" });
    expect(await cli("ci", run.id)).toContain(`CI is still running on https://github.com/org/shop/pull/7`);
    expect(app.cleanup.status.execute(run.id).run.state).toBe("pushed");

    ci.results.push(failing("error TS2304: Cannot find name 'plus'."));
    const fixing = await cli("ci", run.id);
    expect(fixing).toMatch(/try 1 of 5[\s\S]*Batch 4 \(ci\)[\s\S]*CI check build failed\. End of its log:\nerror TS2304/);
    expect(app.cleanup.status.execute(run.id).run.state).toBe("in-progress");
    await expect(app.cleanup.ci.execute(run.id)).rejects.toThrow(/in-progress/);

    edit(run.workspace, "src/calc.ts", (t) => `${t}export const plus = add;\n`);
    expect(await cli("check", run.id)).toContain("All batches are handled");
    await app.cleanup.finish.execute(run.id);
    expect(publisher.opened).toHaveLength(1);
    expect(execFileSync("git", ["log", "-1", "--format=%s", run.branch], { cwd: remote, encoding: "utf8" }).trim())
      .toBe("Clean-up: fix the failing CI checks");

    // CI fails again: the same ci batch opens with the check that fails now; the earlier try is shown.
    ci.results.push(failing("error: lint"));
    const again = await app.cleanup.ci.execute(run.id);
    if (again.kind !== "fixing") throw new Error(again.kind);
    expect([again.tries, again.history]).toEqual([2, ["try 1: still open build"]]);
    expect(app.cleanup.status.execute(run.id).batches.filter((b) => b.category === "ci")).toHaveLength(1);
    edit(run.workspace, "src/calc.ts", (t) => `${t}// lint\n`);
    await app.cleanup.check.execute(run.id);
    await app.cleanup.finish.execute(run.id);

    ci.results.push({ state: "passing" });
    expect(await cli("ci", run.id)).toContain("CI is green");
    expect(await cli("status", run.id)).toContain("CI passing");
  }, 60_000);

  it("after the last failed CI round the ci batch waits for the engineer; once escalated, it is not reopened", async () => {
    const run = await pushedRun();
    for (let round = 1; round < 5; round++) {
      ci.results.push(failing(`round ${round}`));
      expect((await app.cleanup.ci.execute(run.id)).kind).toBe("fixing");
      edit(run.workspace, "src/calc.ts", (t) => `${t}// round ${round}\n`);
      expect((await app.cleanup.check.execute(run.id)).kind).toBe("committed");
      await app.cleanup.finish.execute(run.id);
    }
    ci.results.push(failing("round 5"));
    const waiting = await app.cleanup.ci.execute(run.id);
    expect(waiting).toMatchObject({ kind: "waiting", tries: 5, diagnosis: ["build: still open in 5 of 5 tries"] });
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("waiting");

    const escalated = await app.cleanup.escalate.execute(run.id);
    expect(escalated.issues).toHaveLength(1);
    expect(tracker.opened[0]?.title).toContain("build");
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("finished");
    await app.cleanup.finish.execute(run.id);

    ci.results.push(failing("round 6"));
    expect(await app.cleanup.ci.execute(run.id)).toMatchObject({ kind: "escalated" });
    expect(app.cleanup.status.execute(run.id).run.state).toBe("pushed");
  }, 60_000);

  it("skips a batch by throwing its changes away", async () => {
    const { run } = await app.cleanup.analyze.execute("shop");
    await app.cleanup.next.execute(run.id);
    await app.cleanup.check.execute(run.id);
    await app.cleanup.next.execute(run.id);
    edit(run.workspace, "src/calc.ts", (t) => t.replace("add", "plus"));
    expect((await app.cleanup.skip.execute(run.id, "needs a product decision")).status).toBe("skipped");
    expect(readFileSync(path.join(run.workspace, "src", "calc.ts"), "utf8")).toContain("export const add");
  });
});

describe("git and gh for the pull request", () => {
  it("falls back to the remote's default branch when the base branch is gone or HEAD was detached", async () => {
    const home = tempDir();
    const remote = path.join(home, "remote.git");
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    const work = gitRepo(home, "work", { "a.txt": "a\n" });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: work });
    execFileSync("git", ["push", "--quiet", "origin", "HEAD:refs/heads/main"], { cwd: work });
    execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: remote });
    const git = new GitWorkspace(new ExecFileRunner());

    expect(await git.resolveBase(work, "main")).toEqual({ base: "main" });
    expect(await git.resolveBase(work, "release/gone")).toEqual(
      { base: "main", note: "release/gone is not on the remote; the pull request goes into its default branch main" });
    expect((await git.resolveBase(work, "HEAD")).base).toBe("main");
  });

  /** Answers `git remote get-url` and `gh` with canned output. */
  const runner = (answers: Record<string, { exitCode?: number; stdout?: string; stderr?: string }>): IProcessRunner => ({
    run: async (command, args) => {
      const key = `${command} ${args.slice(0, 2).join(" ")}`;
      const answer = command === "git" ? { stdout: "https://github.com/org/shop.git\n" } : answers[key] ?? {};
      return { exitCode: answer.exitCode ?? 0, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" };
    },
  });
  const pr = "https://github.com/org/shop/pull/7";

  it("reads the PR's checks once, with the tail of each failed job's log", async () => {
    const checks = (list: object[]) => ({ "gh pr checks": { exitCode: 1, stdout: JSON.stringify(list) } });
    const log = Array.from({ length: 50 }, (_, i) => `build\tstep\tline ${i + 1}`).join("\n");
    const failing = await new GhCiChecks(runner({
      ...checks([{ name: "build", bucket: "fail", link: "https://github.com/org/shop/actions/runs/1/job/22" },
        { name: "lint", bucket: "pass" }]),
      "gh run view": { stdout: log },
    })).read("w", pr);
    if (failing.state !== "failing") throw new Error(failing.state);
    expect(failing.failing[0]?.name).toBe("build");
    expect(failing.failing[0]?.log.split("\n")).toHaveLength(40);
    expect(failing.failing[0]?.log).toMatch(/line 50$/);

    expect(await new GhCiChecks(runner(checks([{ name: "build", bucket: "pending" }]))).read("w", pr)).toEqual({ state: "pending" });
    expect(await new GhCiChecks(runner(checks([{ name: "build", bucket: "pass" }, { name: "x", bucket: "skipping" }]))).read("w", pr))
      .toEqual({ state: "passing" });
    expect(await new GhCiChecks(runner({ "gh pr checks": { exitCode: 1, stderr: "no checks reported on the 'x' branch" } })).read("w", pr))
      .toEqual({ state: "none" });
    expect((await new GhCiChecks(runner({})).read("w", "Pushed x. Open the pull request by hand")).state).toBe("unsupported");
  });
});
