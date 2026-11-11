import { execFileSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type App, appPaths, createApp } from "../src/adapters/composition.js";
import type { Finding } from "../src/domain/cleanup.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import type { CleanupGates, ICleanupGateFactory } from "../src/ports/services.js";
import { FakeIssueTracker, gitRepo, tempDir } from "./helpers.js";

/** Stands in for SonarQube: a HACK in `src/` is a HIGH security issue, a TODO a MEDIUM code smell. */
const sonar = {
  name: "sonar",
  async collect(workspace: string): Promise<Finding[]> {
    const src = path.join(workspace, "src");
    return readdirSync(src).flatMap((file) => readFileSync(path.join(src, file), "utf8").split("\n").flatMap((line, i) => {
      const at = { source: "sonar", file: `src/${file}`, line: i + 1, message: line.trim() };
      if (line.includes("HACK")) return [{ ...at, rule: "S2068", category: "security" as const, severity: "HIGH" }];
      if (line.includes("TODO")) return [{ ...at, rule: "S1135", category: "maintainability" as const, severity: "MEDIUM" }];
      return [];
    }));
  },
};

const tests = { kind: "vitest" as const, evaluate: async () => new EvaluationResult("vitest", true, "1/1 passed") };

class FakeGates implements ICleanupGateFactory {
  released = 0;
  forRun(): CleanupGates {
    return { evaluators: [tests], findingSources: [sonar], sonarProjectUrl: "http://sonar/project/issues?id=x",
      sonarProject: "aisdlc-cleanup-x", release: async () => { this.released++; return undefined; } };
  }
}

const CALC = [
  'export const password = "admin"; // HACK',
  "export const add = (a: number, b: number) => a + b; // TODO rename",
  "",
].join("\n");

describe("the fix loop of a clean-up", () => {
  let app: App;
  let home: string;
  let remote: string;
  let tracker: FakeIssueTracker;
  let gates: FakeGates;

  beforeAll(() => {
    for (const role of ["AUTHOR", "COMMITTER"]) {
      process.env[`GIT_${role}_NAME`] = "test";
      process.env[`GIT_${role}_EMAIL`] = "test@example.com";
    }
  });

  const start = (order = "[security, bug, dependency, maintainability, readability]") => {
    home = tempDir();
    cpSync(path.resolve("config"), path.join(home, "config"), { recursive: true });
    const quality = path.join(home, "config", "quality.yaml");
    writeFileSync(quality, readFileSync(quality, "utf8").replace("maxFixAttempts: 3", "maxFixAttempts: 1"));
    const policy = path.join(home, "config", "cleanup.yaml");
    writeFileSync(policy, readFileSync(policy, "utf8").replace("order: [security, bug, dependency, maintainability, readability]", `order: ${order}`)
      .replace("maxTries: 5", "maxTries: 2"));
    remote = path.join(home, "remote.git");
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    const mirror = gitRepo(path.join(home, "mirrors"), "shop", { "src/calc.ts": CALC, "test/calc.test.ts": 'it("adds", () => {});\n' });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: mirror });
    tracker = new FakeIssueTracker();
    gates = new FakeGates();
    app = createApp(appPaths(home), {
      cleanup: { sandbox: { ensureAvailable: async () => {} }, restorer: { restore: async () => {} }, gates, formatters: [] },
      issueTracker: tracker,
    });
  };

  beforeEach(() => start());
  afterEach(() => app.close());

  const edit = (workspace: string, change: (text: string) => string) => {
    const file = path.join(workspace, "src", "calc.ts");
    writeFileSync(file, change(readFileSync(file, "utf8")));
  };

  it("does not commit a batch while one of its MEDIUM code smells is still open (run b4b98e00)", async () => {
    app.close();
    start("[maintainability]");
    const { run } = await app.cleanup.analyze.execute("shop");
    await app.cleanup.next.execute(run.id);
    await app.cleanup.check.execute(run.id);
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("work");

    edit(run.workspace, (t) => `// touched\n${t}`);
    const first = await app.cleanup.check.execute(run.id);
    expect(first).toMatchObject({ kind: "regression", problems: [], tries: 1, maxTries: 2 });
    expect(first.kind === "regression" && first.open.map((o) => o.finding.rule)).toEqual(["S1135"]);
    await expect(app.cleanup.skip.execute(run.id, "too hard")).rejects.toThrow(/cannot be skipped/);

    edit(run.workspace, (t) => t.replace("a + b; // TODO rename", "a + b;"));
    expect(await app.cleanup.check.execute(run.id)).toMatchObject({ kind: "committed", fixed: 1 });
  }, 30_000);

  it("at severity level high, plans only HIGH and above and leaves the MEDIUM smell in SonarQube for later", async () => {
    const { run, batches } = await app.cleanup.analyze.execute("shop", undefined, undefined, "high");
    expect(run.level).toBe("high");
    expect(batches.flatMap((b) => b.findings.map((f) => f.rule))).toEqual(["S2068"]);
    await app.cleanup.next.execute(run.id);
    await app.cleanup.check.execute(run.id);
    await app.cleanup.next.execute(run.id);
    edit(run.workspace, (t) => t.replace('"admin"; // HACK', "process.env.PASSWORD;"));
    expect(await app.cleanup.check.execute(run.id)).toMatchObject({ kind: "committed", fixed: 1 });
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("finished");

    const { reportPath, note } = await app.cleanup.finish.execute(run.id);
    const report = readFileSync(reportPath, "utf8");
    expect(report).toContain("### Left for later");
    expect(report).toContain("- MEDIUM: 1");
    expect(report).toContain("`aisdlc-cleanup-x`");
    expect(report).toContain("create GitHub issues");
    expect(gates.released).toBe(0);
    expect(note).toMatch(/Kept the SonarQube project aisdlc-cleanup-x: 1 findings below level high/);
  }, 30_000);

  it("waits for the engineer after the last try; retry starts the count again, escalate opens an issue per finding left", async () => {
    const { run } = await app.cleanup.analyze.execute("shop");
    await app.cleanup.next.execute(run.id);
    await app.cleanup.check.execute(run.id);

    // The security batch: two failed tries, then it waits with its change kept.
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("work");
    edit(run.workspace, (t) => `// touched\n${t}`);
    expect((await app.cleanup.check.execute(run.id)).kind).toBe("regression");
    const waiting = await app.cleanup.check.execute(run.id);
    expect(waiting).toMatchObject({ kind: "waiting", tries: 2 });
    expect(readFileSync(path.join(run.workspace, "src", "calc.ts"), "utf8")).toContain("// touched");
    expect(tracker.opened).toHaveLength(0);
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("waiting");
    await expect(app.cleanup.check.execute(run.id)).rejects.toThrow(/waits for the engineer/);
    await expect(app.cleanup.finish.execute(run.id)).rejects.toThrow(/not finished/);

    // Retry: two more tries.
    expect(app.cleanup.retry.execute(run.id).kind).toBe("work");
    expect(await app.cleanup.check.execute(run.id)).toMatchObject({ kind: "regression", tries: 1 });
    expect((await app.cleanup.check.execute(run.id)).kind).toBe("waiting");

    // PR and issues: the change made nothing worse, so it is committed, and the finding left gets an issue.
    const escalated = await app.cleanup.escalate.execute(run.id);
    expect(escalated).toMatchObject({ committed: true, issues: ["https://github.com/org/shop/issues/1"] });
    expect(escalated.batch.status).toBe("escalated");
    expect(tracker.opened).toHaveLength(1);
    expect(tracker.opened[0]?.title).toContain("S2068");
    expect(tracker.opened[0]?.remoteUrl).toBe(remote);

    // The run goes on with the next batch, and the PR lists the escalation.
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("work");
    edit(run.workspace, (t) => t.replace("a + b; // TODO rename", "a + b;"));
    expect(await app.cleanup.check.execute(run.id)).toMatchObject({ kind: "committed", fixed: 1 });
    const { reportPath } = await app.cleanup.finish.execute(run.id);
    expect(readFileSync(reportPath, "utf8")).toContain("Escalated to a human");
    expect(readFileSync(reportPath, "utf8")).toContain("https://github.com/org/shop/issues/1");
  }, 30_000);

  it("does not finish while a blocking issue is neither fixed nor escalated", async () => {
    app.close();
    start("[maintainability]");
    const analysis = await app.cleanup.analyze.execute("shop");
    const { run } = analysis;
    await app.cleanup.next.execute(run.id);
    await app.cleanup.check.execute(run.id);
    await app.cleanup.next.execute(run.id);
    edit(run.workspace, (t) => t.replace("a + b; // TODO rename", "a + b;"));
    expect((await app.cleanup.check.execute(run.id)).kind).toBe("committed");
    await expect(app.cleanup.finish.execute(run.id)).rejects.toThrow(/1 SonarQube issues at level verbose are still open and not escalated: S2068/);
  }, 30_000);
});
