import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type App, appPaths, createApp } from "../src/adapters/composition.js";
import type { Finding } from "../src/domain/cleanup.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
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
        ? [{ source: "todo", rule: "todo", category: "maintainability" as const, severity: "MAJOR",
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
  let sandbox: Sandbox;
  let publisher: FakePublisher;

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
    const mirror = gitRepo(path.join(home, "mirrors"), "shop", { "src/calc.ts": CALC, "test/calc.test.ts": TESTS });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: mirror });

    sandbox = new Sandbox();
    publisher = new FakePublisher();
    app = createApp(appPaths(home), {
      cleanup: { sandbox, restorer: { restore: async () => {} }, gates: new FakeGates(), formatters: [trimmer], publisher },
    });
  });

  afterEach(() => app.close());

  const approve = (id: string) => app.decideApproval.approve(id, "engineer");
  const edit = (runWorkspace: string, file: string, change: (text: string) => string) => {
    const target = path.join(runWorkspace, file);
    writeFileSync(target, change(readFileSync(target, "utf8")));
  };

  it("plans, waits for every human gate, and pushes only after approval", async () => {
    const analysis = await app.cleanup.analyze.execute("shop");
    const { run } = analysis;
    expect(analysis.batches.map((b) => b.category)).toEqual(["format", "maintainability", "maintainability", "maintainability"]);
    expect(readFileSync(analysis.planPath, "utf8")).toContain("Approve this plan");
    await expect(app.cleanup.next.execute(run.id)).rejects.toThrow(/analyzed/);

    app.cleanup.plan.accepted(approve(analysis.approval.id));

    // Batch 0: the formatters, no model.
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("formatted");
    expect((await app.cleanup.check.execute(run.id)).kind).toBe("committed");

    // Batch 1: a plain fix is committed straight away.
    const work = await app.cleanup.next.execute(run.id);
    if (work.kind !== "work") throw new Error(work.kind);
    expect(work.findings[0]?.code).toContain("1: export const add");
    edit(run.workspace, "src/calc.ts", (t) => t.replace("a + b; // TODO rename", "a + b;"));
    expect(await app.cleanup.check.execute(run.id)).toMatchObject({ kind: "committed", fixed: 1 });

    // Batch 2: breaking a test is a regression; deleting one needs a human.
    await app.cleanup.next.execute(run.id);
    edit(run.workspace, "src/calc.ts", (t) => t.replace("a - b; // TODO rename", "a - b;"));
    edit(run.workspace, "test/calc.test.ts", (t) => t.replace('it("adds", () => {});', 'it("adds", () => {}); // BROKEN'));
    expect(await app.cleanup.check.execute(run.id)).toMatchObject({ kind: "regression", problems: ["vitest passed before and fails now", "vitest: newly failing adds"] });

    edit(run.workspace, "test/calc.test.ts", (t) => t.replace(" // BROKEN", "").replace(/it\("multiplies".*\r?\n/, ""));
    const gated = await app.cleanup.check.execute(run.id);
    if (gated.kind !== "awaiting-approval") throw new Error(gated.kind);
    expect(gated.gates).toEqual([{ gate: "tests", files: ["test/calc.test.ts"] }]);
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("waiting");

    // A change made after the check is not what the human reviewed.
    edit(run.workspace, "src/calc.ts", (t) => `${t}// sneaked in\n`);
    await expect(app.cleanup.change.accepted(approve(gated.approval.id))).rejects.toThrow(/changed after it was checked/);
    const rechecked = await app.cleanup.check.execute(run.id);
    if (rechecked.kind !== "awaiting-approval") throw new Error(rechecked.kind);
    expect(rechecked.approval.id).not.toBe(gated.approval.id);
    expect((await app.cleanup.change.accepted(approve(rechecked.approval.id))).status).toBe("done");

    // Batch 3: a denied change is thrown away.
    await app.cleanup.next.execute(run.id);
    edit(run.workspace, "src/calc.ts", (t) => t.replace("a * b; // TODO rename", "a * b;"));
    edit(run.workspace, "test/calc.test.ts", (t) => t.replace("subtracts", "takes away"));
    const denied = await app.cleanup.check.execute(run.id);
    if (denied.kind !== "awaiting-approval") throw new Error(denied.kind);
    await app.cleanup.change.denied(app.decideApproval.deny(denied.approval.id, "engineer"));
    expect(readFileSync(path.join(run.workspace, "src", "calc.ts"), "utf8")).toContain("a * b; // TODO rename");
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("finished");

    // Finish: the PR body is written and nothing leaves the machine before a human approves the push.
    const finished = await app.cleanup.finish.execute(run.id);
    expect(readFileSync(finished.reportPath, "utf8")).toContain("2 of 3 findings fixed");
    expect(publisher.opened).toEqual([]);
    expect(execFileSync("git", ["branch", "--list"], { cwd: remote, encoding: "utf8" })).toBe("");

    const push = approve(finished.approval.id);
    expect(await app.cleanup.publish.execute(push)).toBe("https://github.com/org/shop/pull/7");
    expect(execFileSync("git", ["branch", "--list"], { cwd: remote, encoding: "utf8" })).toContain(run.branch);
    expect(execFileSync("git", ["log", "--format=%s", run.branch], { cwd: remote, encoding: "utf8" }))
      .toMatch(/batch 2 \(maintainability\)[\s\S]*batch 1 \(maintainability\)[\s\S]*formatters/);
    await expect(app.cleanup.publish.execute(app.approvals.get(push.id)!)).rejects.toThrow(/executed/);
    expect(app.cleanup.status.execute(run.id).run.state).toBe("pushed");
  }, 30_000);

  it("keeps tool output out of commits and refuses to start without Docker", async () => {
    sandbox.available = false;
    await expect(app.cleanup.analyze.execute("shop")).rejects.toThrow(/Docker is not available/);
    sandbox.available = true;

    const { run, approval } = await app.cleanup.analyze.execute("shop");
    app.cleanup.plan.accepted(approve(approval.id));
    await app.cleanup.next.execute(run.id);
    writeFileSync(path.join(run.workspace, ".aisdlc", "vitest.json"), "{}");
    await app.cleanup.check.execute(run.id);
    const files = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: run.workspace, encoding: "utf8" });
    expect(files.trim()).toBe("src/calc.ts");
    expect(existsSync(path.join(run.workspace, ".aisdlc", "vitest.json"))).toBe(true);
  });

  it("skips a batch by throwing its changes away", async () => {
    const { run, approval } = await app.cleanup.analyze.execute("shop");
    app.cleanup.plan.accepted(approve(approval.id));
    await app.cleanup.next.execute(run.id);
    await app.cleanup.check.execute(run.id);
    await app.cleanup.next.execute(run.id);
    edit(run.workspace, "src/calc.ts", (t) => t.replace("add", "plus"));
    expect((await app.cleanup.skip.execute(run.id, "needs a product decision")).status).toBe("skipped");
    expect(readFileSync(path.join(run.workspace, "src", "calc.ts"), "utf8")).toContain("export const add");
  });
});
