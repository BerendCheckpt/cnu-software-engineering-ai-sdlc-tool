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
  forRun(): CleanupGates {
    return { evaluators: [tests], findingSources: [sonar], sonarProjectUrl: "http://sonar/project/issues?id=x",
      release: async () => undefined };
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
    writeFileSync(policy, readFileSync(policy, "utf8").replace("order: [security, bug, dependency, maintainability, readability]", `order: ${order}`));
    remote = path.join(home, "remote.git");
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    const mirror = gitRepo(path.join(home, "mirrors"), "shop", { "src/calc.ts": CALC, "test/calc.test.ts": 'it("adds", () => {});\n' });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: mirror });
    tracker = new FakeIssueTracker();
    app = createApp(appPaths(home), {
      cleanup: { sandbox: { ensureAvailable: async () => {} }, restorer: { restore: async () => {} }, gates: new FakeGates(), formatters: [] },
      issueTracker: tracker,
    });
  };

  beforeEach(() => start());
  afterEach(() => app.close());

  const edit = (workspace: string, change: (text: string) => string) => {
    const file = path.join(workspace, "src", "calc.ts");
    writeFileSync(file, change(readFileSync(file, "utf8")));
  };

  it("keeps a blocking batch open, refuses to skip it, escalates it, and finishes with the escalation listed", async () => {
    const analysis = await app.cleanup.analyze.execute("shop");
    const { run } = analysis;
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("formatted");
    expect((await app.cleanup.check.execute(run.id)).kind).toBe("committed");

    // The security batch: a change that leaves the HIGH issue open is not committed.
    expect((await app.cleanup.next.execute(run.id)).kind).toBe("work");
    edit(run.workspace, (t) => `// touched\n${t}`);
    const first = await app.cleanup.check.execute(run.id);
    expect(first).toMatchObject({ kind: "regression", problems: [], failures: 1, maxFixAttempts: 1 });
    expect(first.kind === "regression" && first.open.map((o) => o.finding.rule)).toEqual(["S2068"]);
    await expect(app.cleanup.skip.execute(run.id, "too hard")).rejects.toThrow(/cannot be skipped/);

    const second = await app.cleanup.check.execute(run.id);
    expect(second).toMatchObject({ kind: "escalated", where: "https://github.com/org/shop/issues/1" });
    expect(readFileSync(path.join(run.workspace, "src", "calc.ts"), "utf8")).not.toContain("// touched");
    expect(tracker.opened[0]?.remoteUrl).toBe(remote);
    expect(tracker.opened[0]?.body).toContain(`aisdlc cleanup check ${run.id}`);
    expect(tracker.opened[0]?.body).toContain("local only and not pushed");

    // The MEDIUM batch commits once its change is clean, even though MEDIUM never blocks.
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
    await expect(app.cleanup.finish.execute(run.id)).rejects.toThrow(/1 blocking SonarQube issues are still open and not escalated: S2068/);
  }, 30_000);
});
