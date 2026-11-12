import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type App, appPaths, createApp } from "../src/adapters/composition.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import { SAMPLE_RULE } from "../src/infrastructure/reporting/skillWriter.js";
import { gitRepo, tempDir } from "./helpers.js";

describe("crystallized migration skills", () => {
  it("each say that passing tests are not enough where samples exist, in the template's words", () => {
    const root = path.resolve("skills", "migrations");
    for (const skill of readdirSync(root)) {
      const text = readFileSync(path.join(root, skill, "SKILL.md"), "utf8").replaceAll("\r\n", "\n");
      expect(text, skill).toContain(SAMPLE_RULE.join("\n"));
    }
  });
});

const STEPS = "1. Set `<TargetFramework>` to `net10.0`.\n2. Update `Microsoft.*` packages to 10.x.\n";

describe("crystallizing a migration", () => {
  let app: App;
  let home: string;
  let passing = true;

  beforeEach(() => {
    home = tempDir();
    cpSync(path.resolve("config"), path.join(home, "config"), { recursive: true });
    gitRepo(path.join(home, "mirrors"), "counter", { "src/Counter.csproj": "<Project />\n" });
    const gate = { kind: "xunit" as const, evaluate: async () => new EvaluationResult("xunit", passing, passing ? "12/12 passed" : "11/12 passed") };
    app = createApp(appPaths(home), { evaluators: [gate] });
    passing = true;
  });

  afterEach(() => app.close());

  const acceptedMigration = async () => {
    const solution = app.proposeSolution.execute("migrate counter from net9 to net10", "Counter on .NET 10", "");
    await app.evaluateSolution.execute(solution.id, "counter");
    app.acceptSolution.execute(solution.id);
    return solution.id;
  };

  it("needs an accepted solution with passing gates", async () => {
    const draft = app.proposeSolution.execute("migrate", "Draft only", "");
    expect(() => app.requestCrystallization.execute(draft.id, "net9", "net10", STEPS)).toThrow(/only an accepted one/);

    passing = false;
    const failing = app.proposeSolution.execute("migrate", "Fails", "");
    await app.evaluateSolution.execute(failing.id, "counter");
    expect(() => app.acceptSolution.execute(failing.id)).toThrow();

    passing = true;
    const id = await acceptedMigration();
    expect(() => app.requestCrystallization.execute(id, "net9", "cobol", STEPS)).toThrow(/No migration from net9 to cobol/);
    expect(() => app.requestCrystallization.execute(id, "net9", "net10", " ")).toThrow(/steps/);
  });

  it("writes exactly the reviewed draft as the skill, once, after a human approved it", async () => {
    const id = await acceptedMigration();
    const { draftPath, approval } = app.requestCrystallization.execute(id, "net9", "net10", STEPS);
    const draft = readFileSync(draftPath, "utf8");
    expect(draft).toContain("name: migrate-net9-to-net10");
    expect(draft).toContain("Set `<TargetFramework>` to `net10.0`");
    expect(draft).toContain("https://learn.microsoft.com/en-us/aspnet/core/migration/90-to-100");
    expect(draft).toContain("| xunit | passed | 12/12 passed |");
    expect(draft).toContain(SAMPLE_RULE.join("\n"));

    // Nothing is written before the approval, and an edited draft is not what was reviewed.
    expect(() => app.crystallizeMigration.execute(approval)).toThrow(/pending, not approved/);
    writeFileSync(draftPath, `${draft}\nsneaked in\n`);
    expect(() => app.crystallizeMigration.execute(app.decideApproval.approve(approval.id, "engineer"))).toThrow(/changed after it was reviewed/);
    writeFileSync(draftPath, draft);

    const skillPath = app.crystallizeMigration.execute(app.approvals.get(approval.id)!);
    expect(readFileSync(skillPath, "utf8")).toBe(draft);
    expect(app.approvals.get(approval.id)?.status).toBe("executed");
    expect(() => app.requestCrystallization.execute(id, "net9", "net10", STEPS)).toThrow(/only an accepted one|already exists/);

    // From now on the migration answers with the skill and plans nothing.
    const outcome = await app.planMigration.execute({ from: "net9", to: "net10", repository: "counter" });
    expect(outcome).toEqual({ kind: "skill", skill: { from: "net9", to: "net10", skillPath } });
    expect(existsSync(path.join(home, "skills", "migrations", "net9-to-net10", "SKILL.md"))).toBe(true);
  });
});
