import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dispatch, parse } from "../src/adapters/cli/dispatch.js";
import { type App, appPaths, createApp } from "../src/adapters/composition.js";
import { samePath } from "../src/domain/repository.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import { gitRepo, tempDir } from "./helpers.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const passing = { kind: "vitest" as const, evaluate: async () => new EvaluationResult("vitest", true, "1/1 passed") };

describe("a repository folder the engineer already pulled", () => {
  let app: App;
  let home: string;
  let pulled: string;

  beforeAll(() => {
    for (const role of ["AUTHOR", "COMMITTER"]) {
      process.env[`GIT_${role}_NAME`] = "test";
      process.env[`GIT_${role}_EMAIL`] = "test@example.com";
    }
  });

  beforeEach(() => {
    home = tempDir();
    cpSync(path.resolve("config"), path.join(home, "config"), { recursive: true });
    pulled = gitRepo(tempDir(), "Shop App", { "src/orders.ts": "export const UseHttps = true;\n", "README.md": "shop\n" });
    git(pulled, "remote", "add", "origin", "https://github.com/org/shop.git");
    app = createApp(appPaths(home), {
      evaluators: [passing],
      cleanup: {
        sandbox: { ensureAvailable: async () => {} }, restorer: { restore: async () => {} }, formatters: [],
        gates: { forRun: () => ({ evaluators: [passing], findingSources: [], release: async () => undefined }) },
      },
    });
  });

  afterEach(() => app.close());

  const run = (argv: string[], cwd?: string) => {
    const { command, args } = parse(argv);
    return dispatch(app, command!, args, undefined, cwd);
  };

  it("links a folder from inside it, under its own name, once, and reads it like a mirror", async () => {
    mkdirSync(path.join(pulled, "src", "deep"), { recursive: true });
    const first = await app.linkRepository.execute(path.join(pulled, "src", "deep"));
    expect(first.created).toBe(true);
    expect(first.entry.name).toBe("Shop-App");
    expect(samePath(first.entry.path, pulled)).toBe(true);
    expect((await app.linkRepository.execute(pulled.toUpperCase())).created).toBe(process.platform !== "win32");

    const hits = await app.browseCode.search("Shop-App", "UseHttps");
    expect(hits.map((h) => h.path)).toEqual(["src/orders.ts"]);
    expect(await app.browseCode.read("shop-app", "README.md", 1, 1)).toBe("1: shop");
  });

  it("refuses a folder outside git and a name that is taken, and unlinks without touching the folder", async () => {
    await expect(app.linkRepository.execute(tempDir())).rejects.toThrow(/not inside a git repository/);
    await app.linkRepository.execute(pulled);
    const twin = gitRepo(tempDir(), "Shop App", { "a.txt": "a\n" });
    await expect(app.linkRepository.execute(twin)).rejects.toThrow(/already used by .*--name/);
    expect((await app.linkRepository.execute(twin, "shop-copy")).entry.name).toBe("shop-copy");

    gitRepo(path.join(home, "mirrors"), "cloned", { "b.txt": "b\n" });
    expect(app.linkRepository.list().map((e) => `${e.name}:${e.kind}`)).toEqual(["Shop-App:linked", "shop-copy:linked", "cloned:mirror"]);
    // A folder inside a mirror is that mirror, not a new link.
    expect((await app.linkRepository.execute(path.join(home, "mirrors", "cloned")))).toMatchObject({ created: false, entry: { name: "cloned" } });

    app.linkRepository.unlink("shop-copy");
    expect(readFileSync(path.join(twin, "a.txt"), "utf8")).toBe("a\n");
    expect(() => app.linkRepository.unlink("shop-copy")).toThrow(/No linked folder/);
  });

  it("evaluates from the current folder's last commit, says what is not committed, and leaves the folder alone", async () => {
    writeFileSync(path.join(pulled, "README.md"), "work in progress\n");
    const branch = git(pulled, "rev-parse", "--abbrev-ref", "HEAD");
    const diff = "--- a/src/orders.ts\n+++ b/src/orders.ts\n@@ -1 +1 @@\n-export const UseHttps = true;\n+export const UseHttps = false;\n";
    const solution = app.proposeSolution.execute("turn off https", "No https", diff);

    const result = await run(["eval", solution.id], path.join(pulled, "src"));
    const [using, note] = result.text.split("\n");
    const shown = /^using linked repository Shop-App \((.+)\)$/.exec(using!)?.[1];
    expect(shown && samePath(shown, pulled)).toBe(true);
    expect(note).toBe(`1 file is not committed in Shop-App: aisdlc works from the last commit of ${branch}.`);
    expect(result.remember?.repo).toBe("Shop-App");

    const workspace = path.join(home, "work", solution.id);
    expect(readFileSync(path.join(workspace, "src", "orders.ts"), "utf8")).toContain("UseHttps = false");
    expect(readFileSync(path.join(workspace, "README.md"), "utf8").replace(/\r\n/g, "\n")).toBe("shop\n");
    // The engineer's folder: same branch, same files, the same one uncommitted change.
    expect(git(pulled, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    expect(git(pulled, "status", "--porcelain")).toBe("M README.md");
    expect(readFileSync(path.join(pulled, "src", "orders.ts"), "utf8")).toContain("UseHttps = true");
  }, 30_000);

  it("analyzes a clean-up from the current folder, and its branch pushes to the folder's own origin", async () => {
    const result = await run(["cleanup", "analyze"], pulled);
    expect(result.text).toMatch(/^session: cleanup-[0-9a-f]{8}-\d\d-\d\d-\d{4} .*\nusing linked repository Shop-App/);
    const runId = result.remember?.run;
    expect(runId).toBeDefined();
    expect(git(path.join(home, "work", "cleanup", runId!, "repo"), "remote", "get-url", "origin")).toBe("https://github.com/org/shop.git");
    expect(git(pulled, "branch", "--list", "cleanup/*")).toBe("");
  }, 30_000);

  it("leaves --repo required outside a git repository, and an explicit --repo wins", async () => {
    await expect(run(["eval", "some-id"], tempDir())).rejects.toThrow(/--repo is required/);
    await expect(run(["eval", "some-id", "--repo", "elsewhere"], pulled)).rejects.toThrow(/No solution some-id/);
    expect(app.linkRepository.list()).toEqual([]);
  });
});
