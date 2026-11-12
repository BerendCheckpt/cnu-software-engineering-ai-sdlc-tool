import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { RequestApproval } from "../src/application/approvals.js";
import { RequestDocs } from "../src/application/docs.js";
import { PlanMigration } from "../src/application/planMigration.js";
import { CodeTermExtractor } from "../src/domain/codeTermExtractor.js";
import type { DocSource } from "../src/domain/docs.js";
import { MarkdownChunker } from "../src/domain/markdownChunker.js";
import { type MigrationStep, NO_NOISE_RULES, type NoiseRules } from "../src/domain/migration.js";
import { QuestionIndex } from "../src/domain/openQuestion.js";
import { loadNoiseRules } from "../src/infrastructure/migration/yamlNoiseRules.js";
import { GitRepoMirror } from "../src/infrastructure/git/gitRepoMirror.js";
import { YamlMigrationCatalog } from "../src/infrastructure/migration/yamlMigrationCatalog.js";
import { ExecFileRunner } from "../src/infrastructure/process/execFileRunner.js";
import { openDatabase } from "../src/infrastructure/sqlite/database.js";
import { SqliteApprovalStore } from "../src/infrastructure/sqlite/sqliteApprovalStore.js";
import { SqliteDocStore } from "../src/infrastructure/sqlite/sqliteDocStore.js";
import { FakeCatalog, gitRepo, tempDir } from "./helpers.js";

const source = (id: string, version: string): DocSource =>
  ({ id, framework: "dotnet", version, url: `https://learn.microsoft.com/${id}` });

const NET9 = source("dotnet-9-compat", "9");
const NET10 = source("dotnet-10-compat", "10");

const CATALOG_YAML = `migrations:
  - from: net9
    to: net10
    sourceDocs: [dotnet-9-compat]
    targetDocs: [dotnet-10-compat]
    tool: Set TargetFramework to net10.0.
  - from: net9
    to: net11
    sourceDocs: [dotnet-9-compat]
    targetDocs: [dotnet-11-compat]
  - from: ckp-retailerplugin
    to: cnu-retailerplugin
    agent: cnu:shiva
`;

describe("PlanMigration", () => {
  let docs: SqliteDocStore;
  let approvals: SqliteApprovalStore;
  let root: string;
  let planner: PlanMigration;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    docs = new SqliteDocStore(db);
    approvals = new SqliteApprovalStore(db);
    root = tempDir();
    const catalogFile = path.join(root, "migrations.yaml");
    writeFileSync(catalogFile, CATALOG_YAML);
    const mirrors = path.join(root, "mirrors");
    gitRepo(mirrors, "shop-api", { "src/Cache.cs": "var formatter = new BinaryFormatter();\n" });
    planner = plannerWith(NO_NOISE_RULES);
  });

  const plannerWith = (rules: NoiseRules) => new PlanMigration(
    path.join(root, "work"),
    new YamlMigrationCatalog(path.join(root, "migrations.yaml"), path.join(root, "skills")),
    docs,
    new RequestDocs(new FakeCatalog([NET9, NET10]), docs, new RequestApproval(approvals)),
    new GitRepoMirror(path.join(root, "mirrors"), new ExecFileRunner()),
    rules,
  );

  const loadDocs = (...sources: DocSource[]) => {
    for (const s of sources) {
      docs.replaceChunks(s, new MarkdownChunker().chunk(s, "## BinaryFormatter removed\n\nUse `System.Text.Json` instead."));
    }
  };

  it("uses a crystallized skill before anything else", async () => {
    mkdirSync(path.join(root, "skills", "net9-to-net10"), { recursive: true });
    writeFileSync(path.join(root, "skills", "net9-to-net10", "SKILL.md"), "# skill");
    expect((await planner.execute({ from: "net9", to: "net10", repository: "shop-api" })).kind).toBe("skill");
  });

  it("escalates a migration that is not grounded in official documentation", async () => {
    const outcome = await planner.execute({ from: "cobol", to: "net10", repository: "shop-api" });
    expect(outcome).toEqual({ kind: "escalate", reason: expect.stringContaining("No migration from cobol to net10") });
  });

  it("hands the retailer-plugin pair to its agent, without docs or a mirror, in any case", async () => {
    const outcome = await planner.execute({ from: "CKP-RetailerPlugin", to: "cnu-retailerplugin", repository: "not-linked" });
    expect(outcome).toMatchObject({ kind: "delegate", agent: "cnu:shiva" });
    expect(approvals.pending()).toEqual([]);
  });

  it("asks a human to approve the missing docs, and downloads nothing itself", async () => {
    loadDocs(NET9);
    const outcome = await planner.execute({ from: "net9", to: "net10", repository: "shop-api" });
    expect(outcome.kind).toBe("docs-missing");
    if (outcome.kind !== "docs-missing") return;
    expect(outcome.missing).toEqual(["dotnet-10-compat"]);
    expect(approvals.get(outcome.approvalIds[0]!)?.status).toBe("pending");
  });

  it("escalates when an official source for a required doc is unknown", async () => {
    loadDocs(NET9);
    const outcome = await planner.execute({ from: "net9", to: "net11", repository: "shop-api" });
    expect(outcome).toEqual({ kind: "escalate", reason: "No official documentation source for dotnet-11-compat." });
  });

  it("asks for the repository when it is not mirrored", async () => {
    loadDocs(NET9, NET10);
    expect(await planner.execute({ from: "net9", to: "net10", repository: "billing" }))
      .toEqual({ kind: "repo-missing", repository: "billing" });
  });

  it("plans steps from the target docs and the code that uses the named APIs", async () => {
    loadDocs(NET9, NET10);
    const outcome = await planner.execute({ from: "net9", to: "net10", repository: "shop-api" });
    if (outcome.kind !== "plan") throw new Error(`expected a plan, got ${outcome.kind}`);

    expect(outcome.steps).toEqual([{
      heading: "BinaryFormatter removed",
      docUrl: NET10.url,
      locations: [{ path: "src/Cache.cs", line: 1, text: "var formatter = new BinaryFormatter();" }],
      decision: "port",
    }]);
    expect(outcome.questions).toEqual([]);
    const plan = readFileSync(outcome.reportPath, "utf8");
    expect(plan).toContain("Set TargetFramework to net10.0.");
    expect(plan).toContain("`src/Cache.cs:1`");
  });

  describe("on a repository with the noise seen in real runs", () => {
    const RULES: NoiseRules = {
      commonTerms: ["typescript", "github", "powershell", "IsDevelopment", "launchSettings.json"],
      boilerplateHeadings: ["Actively supported versions"],
      areas: { blazor: ["*.razor"] },
    };

    const NOISY_DOCS = `## BinaryFormatter removed

Use \`System.Text.Json\` instead.

## BinaryFormatter in caches

BinaryFormatter is gone from caches too.

## Actively supported versions

Angular supports \`typescript\` releases listed on GitHub.

## Blazor

### NotFound page

Set \`Router.NotFoundPage\`; \`IsDevelopment\` and \`launchSettings.json\` are unchanged.

### Boot configuration file inlined

Check integrity with the PowerShell script; \`BootConfig\` is now inlined.

## Extensions

[BackgroundService runs all of ExecuteAsync as a Task](extensions/10.0/backgroundservice)

[ProviderAliasAttribute moved to another assembly](extensions/10.0/provideralias)

## TimeoutCache notes

Use \`System.Text.Json\` instead.`;

    const NOISY_REPO = {
      "src/Cache.cs": "var formatter = new BinaryFormatter();\nvar json = System.Text.Json.JsonSerializer.Serialize(x);\n",
      "src/TimeoutCache.cs": "class TimeoutCache { }\n",
      "src/Jobs/Runner.cs": "public Task ExecuteAsync() => Task.CompletedTask;\n",
      "src/Logging/Alias.cs": "[ProviderAlias(\"Fancy\")]\nclass FancyLoggerProvider { }\n",
      "Program.cs": "if (app.Environment.IsDevelopment()) app.UseDeveloperExceptionPage();\nvar bootConfig = 1;\n",
      "README.md": "Built with typescript, hosted on GitHub. No BinaryFormatter here.\n```powershell\n",
      "package.json": '{ "devDependencies": { "typescript": "5.9.0" } }\n',
      "package-lock.json": '"node_modules/system.text.json": {}\n"node_modules/typescript": {}\n',
      "yarn.lock": "system.text.json@1.0.0:\n",
      "web/pnpm-lock.yaml": "system.text.json: 1.0.0\n",
      "src/packages.lock.json": '"System.Text.Json": { "resolved": "9.0.0" }\n',
      ".editorconfig": "# System.Text.Json style\n",
      ".gitignore": "System.Text.Json.cache\n",
    };

    const plan = async (repo: string, files: Record<string, string>, markdown = NOISY_DOCS) => {
      gitRepo(path.join(root, "mirrors"), repo, files);
      loadDocs(NET9);
      docs.replaceChunks(NET10, new MarkdownChunker(RULES.boilerplateHeadings).chunk(NET10, markdown));
      const outcome = await plannerWith(RULES).execute({ from: "net9", to: "net10", repository: repo });
      if (outcome.kind !== "plan") throw new Error(`expected a plan, got ${outcome.kind}`);
      return outcome;
    };
    const ported = (steps: MigrationStep[]) => steps.filter((s) => s.decision === "port");
    const headings = async (repo: string, files: Record<string, string>) =>
      ported((await plan(repo, files)).steps).map((s) => s.heading);

    it("keeps the real steps and finds their code outside lockfiles and editor or git config", async () => {
      const steps = ported((await plan("noisy-app", NOISY_REPO)).steps);
      expect(steps.map((s) => s.heading))
        .toEqual(["BinaryFormatter removed", "Extensions › ProviderAliasAttribute moved to another assembly"]);
      expect(steps[0]!.locations.map((l) => `${l.path}:${l.line}`).sort())
        .toEqual(["README.md:1", "src/Cache.cs:1", "src/Cache.cs:2"]);
    });

    it("lists a location under one step only", async () => {
      expect(await headings("noisy-app", NOISY_REPO)).not.toContain("BinaryFormatter in caches");
    });

    it("skips a section that repeats an earlier one word for word", async () => {
      expect(await headings("noisy-app", NOISY_REPO)).not.toContain("TimeoutCache notes");
    });

    it("skips boilerplate sections and sections that only name common terms", async () => {
      const found = await headings("noisy-app", NOISY_REPO);
      expect(found).not.toContain("Actively supported versions");
      expect(found.some((h) => h.startsWith("Blazor"))).toBe(false);
    });

    it("plans an area's sections only when the repository uses the area", async () => {
      const found = await headings("blazor-app", {
        "Components/App.razor": "<Router AppAssembly=\"typeof(App).Assembly\" />\n",
        "Program.cs": "Router.NotFoundPage = typeof(NotFound);\nvar bootConfig = 1;\n",
      });
      expect(found).toEqual(["Blazor › NotFound page", "Blazor › Boot configuration file inlined"]);
    });

    it("matches a linked item only in a file that names two of its terms", async () => {
      const { steps } = await plan("worker-app", {
        "src/Worker.cs": "class Worker : BackgroundService\n{\n  protected override Task ExecuteAsync(CancellationToken t) => Task.CompletedTask;\n}\n",
        "src/Jobs/Runner.cs": "public Task ExecuteAsync() => Task.CompletedTask;\n",
      });
      const item = steps.find((s) => s.heading === "Extensions › BackgroundService runs all of ExecuteAsync as a Task");
      expect(item?.docUrl).toBe("https://learn.microsoft.com/extensions/10.0/backgroundservice");
      expect(item?.locations.map((l) => `${l.path}:${l.line}`)).toEqual(["src/Worker.cs:1", "src/Worker.cs:3"]);
    });

    it("ignores terms named in many sections and lists them in the plan", async () => {
      const markdown = [1, 2, 3, 4].map((n) => `## Change ${n}\n\nThe \`HostBuilder\` now sets \`Option${n}Flag\`.`).join("\n\n");
      const outcome = await plan("host-app", { "src/Host.cs": "var builder = new HostBuilder();\n" }, markdown);
      expect(outcome.steps).toEqual([]);
      const report = readFileSync(outcome.reportPath, "utf8");
      expect(report).toContain("## Ignored as too common\n\n");
      expect(report).toContain("- hostbuilder");
    });

    it("lists a doc area the repository does not use once, as a dropped step", async () => {
      const { steps } = await plan("noisy-app", NOISY_REPO);
      const dropped = steps.filter((s) => s.decision === "drop");
      expect(dropped).toEqual([expect.objectContaining({ heading: "Blazor", locations: [], note: "The repository does not use Blazor." })]);
    });

    it("asks a question when a section names only too-common terms the repository uses", async () => {
      const markdown = [1, 2, 3].map((n) => `## Change ${n}\n\nThe \`HostBuilder\` now sets \`Option${n}Flag\`.`)
        .concat("## HostBuilder defaults\n\nThe `HostBuilder` defaults changed.").join("\n\n");
      const outcome = await plan("host-app", { "src/Host.cs": "var builder = new HostBuilder();\n" }, markdown);

      expect(outcome.steps).toEqual([expect.objectContaining({ heading: "HostBuilder defaults", decision: "question" })]);
      expect(outcome.questions).toEqual([{ id: "Q1", status: "needs-attention", topic: expect.stringContaining("HostBuilder") }]);
      const report = readFileSync(outcome.reportPath, "utf8");
      expect(report).toContain("| question | HostBuilder defaults | Q1 |");
      expect(QuestionIndex.parse(report)).toEqual({ kind: "index", questions: outcome.questions });
    });

    it("asks nothing when the repository does not use the too-common terms", async () => {
      const markdown = [1, 2, 3].map((n) => `## Change ${n}\n\nThe \`HostBuilder\` now sets \`Option${n}Flag\`.`)
        .concat("## HostBuilder defaults\n\nThe `HostBuilder` defaults changed.").join("\n\n");
      const outcome = await plan("plain-app", { "src/App.cs": "class App { }\n" }, markdown);
      expect(outcome.steps).toEqual([]);
      expect(readFileSync(outcome.reportPath, "utf8")).not.toContain("## Open questions");
    });
  });
});

describe("YamlMigrationCatalog", () => {
  const catalog = (yaml: string) => {
    const file = path.join(tempDir(), "migrations.yaml");
    writeFileSync(file, yaml);
    return () => new YamlMigrationCatalog(file, path.join(tempDir(), "skills"));
  };

  it("refuses an agent on any pair other than the retailer-plugin pair", () => {
    expect(catalog("migrations:\n  - { from: net9, to: net10, agent: cnu:shiva }\n"))
      .toThrow(/Only the retailer-plugin pair may name an agent/);
  });

  it("still needs official docs for a pair without an agent", () => {
    expect(catalog("migrations:\n  - { from: net9, to: net10 }\n")).toThrow(/needs sourceDocs and targetDocs/);
  });

  it("reads config/migrations.yaml, where only the retailer-plugin pair is delegated", () => {
    const real = new YamlMigrationCatalog(path.join(process.cwd(), "config", "migrations.yaml"), tempDir());
    expect(real.findPath("ckp-retailerplugin", "cnu-retailerplugin")?.agent).toBe("cnu:shiva");
    expect(real.findPath("net9", "net10")?.agent).toBeUndefined();
  });
});

describe("GitRepoMirror", () => {
  const mirrors = () => path.join(tempDir(), "mirrors");

  it("does not search lockfiles or editor and git config", async () => {
    const root = mirrors();
    gitRepo(root, "app", {
      "src/App.cs": "UseHttps();\n",
      "package-lock.json": "UseHttps\n",
      "yarn.lock": "UseHttps\n",
      "sub/pnpm-lock.yaml": "UseHttps\n",
      "packages.lock.json": "UseHttps\n",
      ".editorconfig": "UseHttps\n",
      "sub/.gitignore": "UseHttps\n",
    });
    const hits = await new GitRepoMirror(root, new ExecFileRunner()).search("app", ["UseHttps"], 10);
    expect(hits.map((h) => h.path)).toEqual(["src/App.cs"]);
  });

  it("tells whether a repository shows a file glob or a word", async () => {
    const root = mirrors();
    gitRepo(root, "app", { "Pages/Index.cshtml": "<h1>Hi</h1>\n", "app.csproj": "<UseWPF>true</UseWPF>\n" });
    const mirror = new GitRepoMirror(root, new ExecFileRunner());
    expect(await mirror.uses("app", ["*.razor"])).toBe(false);
    expect(await mirror.uses("app", ["*.CSHTML"])).toBe(true);
    expect(await mirror.uses("app", ["*.razor", "<usewpf>"])).toBe(true);
    expect(await mirror.uses("app", ["<UseWindowsForms>"])).toBe(false);
  });
});

describe("CodeTermExtractor", () => {
  it("finds API names in code spans and PascalCase words", () => {
    expect(new CodeTermExtractor().extract("`HttpClient.Timeout` changed; BinaryFormatter is gone. Use `x`."))
      .toEqual(["HttpClient.Timeout", "BinaryFormatter"]);
  });

  it("ignores the configured common terms and the given ones, in any case", () => {
    const extractor = new CodeTermExtractor(["typescript", "GitHub", "IsDevelopment", "launchSettings.json"]);
    expect(extractor.extract("`TypeScript`, GitHub, `isDevelopment` and `launchSettings.json`.")).toEqual([]);
    expect(extractor.extract("`typescript`, `HostBuilder` and `Router.NotFoundPage`", new Set(["hostbuilder"])))
      .toEqual(["Router.NotFoundPage"]);
  });

  it("searches an attribute by the name code uses, without the suffix", () => {
    expect(new CodeTermExtractor().extract("ProviderAliasAttribute moved")).toEqual(["ProviderAlias"]);
  });
});

describe("MarkdownChunker for migrations", () => {
  const page = "## Blazor\n\nIntro.\n\n### Boot config\n\nText.\n\n## Feedback\n\nRate us.\n\n### Was this helpful\n\nYes.\n\n# Next page\n\n### Loose\n\nMore.";

  it("keeps a section's area in its heading and leaves out boilerplate sections", () => {
    const chunks = new MarkdownChunker(["feedback"]).chunk(NET10, page);
    expect(chunks.map((c) => c.heading)).toEqual(["Blazor", "Blazor › Boot config", "Loose"]);
  });

  it("names the area of a section, also of a continued one", () => {
    expect(MarkdownChunker.areaOf("Blazor › Boot config (continued)")).toBe("Blazor");
    expect(MarkdownChunker.areaOf("SDK and MSBuild (continued)")).toBe("SDK and MSBuild");
  });
});

describe("loadNoiseRules", () => {
  it("reads config/noise.yaml", () => {
    const rules = loadNoiseRules(path.join(process.cwd(), "config", "noise.yaml"));
    expect(rules.commonTerms).toContain("powershell");
    expect(rules.boilerplateHeadings).toContain("Feedback");
    expect(rules.areas.Blazor).toContain("*.razor");
  });

  it("leaves nothing out without the file", () => {
    expect(loadNoiseRules(path.join(tempDir(), "missing.yaml"))).toEqual(NO_NOISE_RULES);
  });
});
