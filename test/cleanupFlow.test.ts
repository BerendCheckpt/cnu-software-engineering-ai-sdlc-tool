import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dispatch, parse } from "../src/adapters/cli/dispatch.js";
import { type App, appPaths, createApp } from "../src/adapters/composition.js";
import type { Finding } from "../src/domain/cleanup.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import { dayStamp } from "../src/domain/progress.js";
import type { CleanupGates, ICleanupGateFactory, IFormatter, IPullRequestPublisher, ISandbox } from "../src/ports/services.js";
import { gitRepo, tempDir } from "./helpers.js";

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
  async open(_workspace: string, branch: string) {
    this.opened.push(branch);
    return "https://github.com/org/shop/pull/7";
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
  const branch = `cleanup/${dayStamp()}`;

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
    app = createApp(appPaths(home), {
      cleanup: { sandbox, restorer: { restore: async () => {} }, gates: new FakeGates(), formatters: [trimmer], publisher },
    });
  });

  afterEach(() => app.close());

  const edit = (runWorkspace: string, file: string, change: (text: string) => string) => {
    const target = path.join(runWorkspace, file);
    writeFileSync(target, change(readFileSync(target, "utf8")));
  };

  it("runs every batch without a human, flags gated changes, and ends in a PR ranked by severity", async () => {
    const analysis = await app.cleanup.analyze.execute("shop");
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

    // Finish: the PR body, the push of the one branch and the PR, with no approval in between.
    const finished = await app.cleanup.finish.execute(run.id);
    expect(finished.pullRequest).toBe("https://github.com/org/shop/pull/7");
    expect(publisher.opened).toEqual([branch]);
    expect(execFileSync("git", ["branch", "--list"], { cwd: remote, encoding: "utf8" }).trim()).toBe(branch);
    expect(execFileSync("git", ["log", "--format=%s", branch], { cwd: remote, encoding: "utf8" }))
      .toMatch(/batch 3 \(maintainability\)[\s\S]*batch 2 \(maintainability\)[\s\S]*batch 1 \(maintainability\)[\s\S]*formatters/);

    const report = readFileSync(finished.reportPath, "utf8");
    expect(report).toContain("3 of 3 findings fixed");
    const changelog = report.slice(report.indexOf("### Changelog"), report.indexOf("### Security concerns"));
    expect(changelog.split("\n").filter((l) => l.startsWith("| HIGH") || l.startsWith("| MEDIUM")).map((l) => l.slice(2, 8)))
      .toEqual(["HIGH |", "MEDIUM", "MEDIUM"]);
    expect(changelog).toMatch(/src\/calc\.ts:2` \| `[0-9a-f]{8}` ⚠/);
    expect(report).toContain("Review these changes closely");
    expect(report).toContain("tests: `test/calc.test.ts`");

    expect(app.cleanup.status.execute(run.id).run.state).toBe("pushed");
    await expect(app.cleanup.finish.execute(run.id)).rejects.toThrow(/pushed/);
    await expect(app.cleanup.analyze.execute("shop")).rejects.toThrow(/already ran on shop as branch/);
  }, 30_000);

  it("refuses a branch that already exists in the repository or on the remote", async () => {
    execFileSync("git", ["branch", branch], { cwd: mirror });
    await expect(app.cleanup.analyze.execute("shop")).rejects.toThrow(/already exists in the repository/);

    execFileSync("git", ["push", "--quiet", "origin", `${branch}:${branch}`], { cwd: mirror });
    execFileSync("git", ["branch", "-D", branch], { cwd: mirror });
    await expect(app.cleanup.analyze.execute("shop")).rejects.toThrow(/already exists on the remote/);
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
    const session = `cleanup-${runId}-${dayStamp()}`;
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
