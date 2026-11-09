import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SonarFixLoop } from "../src/application/sonarFixLoop.js";
import type { DocSource } from "../src/domain/docs.js";
import { QualityPolicy } from "../src/domain/quality.js";
import { EscalationReportWriter } from "../src/infrastructure/reporting/escalationReportWriter.js";
import { openDatabase } from "../src/infrastructure/sqlite/database.js";
import { SqliteFixLoopStore } from "../src/infrastructure/sqlite/sqliteFixLoopStore.js";
import type { IDocFetcher, IIssueTracker, IRepoMirror, ISourceCatalog } from "../src/ports/services.js";

export function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "aisdlc-"));
}

/** A committed git repository with the given files, inside `root`. */
export function gitRepo(root: string, name: string, files: Record<string, string>): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "init");
  return dir;
}

export class FakeCatalog implements ISourceCatalog {
  constructor(private readonly sources: DocSource[]) {}
  docHosts() { return ["learn.microsoft.com"]; }
  repositoryHosts() { return ["github.com"]; }
  find(id: string) { return this.sources.find((s) => s.id === id); }
  all() { return this.sources; }
}

export class FakeFetcher implements IDocFetcher {
  calls = 0;
  constructor(private readonly markdown: string, private readonly fail = false) {}
  async fetchMarkdown(): Promise<string> {
    this.calls++;
    if (this.fail) throw new Error("network down");
    return this.markdown;
  }
}

export const DOTNET_10: DocSource = {
  id: "dotnet-10-compat",
  framework: "dotnet",
  version: "10",
  url: "https://learn.microsoft.com/en-us/dotnet/core/compatibility/10",
};

/** Stands in for `gh issue create`: records what would have been opened. */
export class FakeIssueTracker implements IIssueTracker {
  opened: { remoteUrl: string | undefined; title: string; body: string }[] = [];
  constructor(private readonly answer = "https://github.com/org/shop/issues/1") {}
  async open(remoteUrl: string | undefined, title: string, bodyFile: string): Promise<string> {
    this.opened.push({ remoteUrl, title, body: readFileSync(bodyFile, "utf8") });
    return this.answer;
  }
}

/** A fix loop on its own in-memory store: BLOCKER and HIGH block, MEDIUM is reported. */
export function fixLoopFor(options: { maxFixAttempts?: number; tracker?: IIssueTracker; db?: DatabaseSync } = {}): SonarFixLoop {
  return new SonarFixLoop(new SqliteFixLoopStore(options.db ?? openDatabase(":memory:")),
    new QualityPolicy(["BLOCKER", "HIGH"], ["MEDIUM"], options.maxFixAttempts ?? 3), new EscalationReportWriter(),
    options.tracker ?? new FakeIssueTracker(), path.join(tempDir(), "escalations"), () => {});
}

/** A mirror that only knows its remote, for code that escalates. */
export function mirrorWithRemote(remote?: string): IRepoMirror {
  return { remoteUrl: async () => remote } as unknown as IRepoMirror;
}
