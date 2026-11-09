import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "../../domain/errors.js";
import type { CodeLocation } from "../../domain/migration.js";
import { PathGuard } from "../../domain/pathGuard.js";
import { requireRepositoryName, samePath, type RepositoryEntry } from "../../domain/repository.js";
import type { IProcessRunner, IRepoMirror } from "../../ports/services.js";
import type { ILinkedRepositoryStore } from "../../ports/stores.js";

const MAX_SNIPPET_LINES = 40;
const MAX_LINE_LENGTH = 200;
/** Generated lockfiles and editor or git config name packages and paths, never the code that uses an API. */
const NOT_CODE = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "packages.lock.json", ".editorconfig", ".gitignore"]
  .map((file) => `:(exclude,glob)**/${file}`);

/**
 * Shallow, read-only clones under one root, and folders the engineer linked (read only as well). Search uses
 * `git grep`, so only tracked files are searched.
 */
export class GitRepoMirror implements IRepoMirror {
  private readonly root: PathGuard;

  constructor(root: string, private readonly runner: IProcessRunner, private readonly linked?: ILinkedRepositoryStore) {
    this.root = new PathGuard(root);
  }

  exists(name: string): boolean {
    return existsSync(this.repoPath(name));
  }

  async clone(name: string, url: URL): Promise<void> {
    if (this.linked?.get(name)) throw new DomainError(`${name} is a linked folder; it needs no clone.`);
    const destination = this.repoPath(name);
    if (existsSync(destination)) throw new DomainError(`Mirror ${name} already exists.`);
    mkdirSync(this.root.resolve("."), { recursive: true });
    // `--` ends the options, so a URL can never be read as one.
    const result = await this.runner.run("git", ["clone", "--depth", "1", "--", url.href, destination], this.root.resolve("."));
    if (result.exitCode !== 0) throw new Error(`git clone failed: ${result.stderr.trim()}`);
  }

  /** With `minTermsPerFile`, only files that contain that many different terms count, such as a type and its method. */
  async search(name: string, terms: string[], limit: number, minTermsPerFile = 1): Promise<CodeLocation[]> {
    if (!terms.length) return [];
    const needed = Math.min(minTermsPerFile, terms.length);
    // Counting terms per file needs every hit of the file, so the per-file cap only applies to one-term searches.
    const cap = needed > 1 ? [] : ["--max-count", "5"];
    const lowered = terms.map((t) => t.toLowerCase());
    const hits = this.parse((await this.grep(name, ["-n", ...cap], terms)).stdout);
    const termsIn = new Map<string, Set<string>>();
    for (const hit of hits) {
      const found = termsIn.get(hit.path) ?? new Set<string>();
      lowered.filter((t) => hit.text.toLowerCase().includes(t)).forEach((t) => found.add(t));
      termsIn.set(hit.path, found);
    }
    return this.rank(hits.filter((h) => termsIn.get(h.path)!.size >= needed), lowered).slice(0, limit);
  }

  /** Whether the repository shows any of the markers: a file glob such as `*.razor`, or a word in the code. */
  async uses(name: string, markers: string[]): Promise<boolean> {
    const globs = markers.filter((m) => m.includes("*")).map((g) => `:(glob,icase)**/${g}`);
    if (globs.length) {
      const files = await this.runner.run("git", ["ls-files", "--", ...globs], this.repoPath(name));
      if (files.stdout.trim()) return true;
    }
    const words = markers.filter((m) => !m.includes("*"));
    return words.length > 0 && (await this.grep(name, ["-q"], words)).exitCode === 0;
  }

  async read(name: string, relativePath: string, startLine: number, endLine: number): Promise<string> {
    const file = new PathGuard(this.repoPath(name)).resolve(relativePath);
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    const first = Math.max(1, Math.floor(startLine));
    const last = Math.min(lines.length, Math.floor(endLine), first + MAX_SNIPPET_LINES - 1);
    return lines.slice(first - 1, last).map((l, i) => `${first + i}: ${l}`).join("\n");
  }

  async checkout(name: string, destination: string): Promise<void> {
    // Run from the source: the mirrors root may not exist when only linked folders are used.
    const source = this.repoPath(name);
    const result = await this.runner.run("git", ["clone", "--local", "--", source, destination], source);
    if (result.exitCode !== 0) throw new Error(`git clone --local failed: ${result.stderr.trim()}`);
  }

  async applyPatch(destination: string, diff: string): Promise<void> {
    const patch = path.join(destination, ".git", "aisdlc-solution.patch");
    await writeFile(patch, diff.endsWith("\n") ? diff : `${diff}\n`, "utf8");
    const result = await this.runner.run("git", ["apply", "--whitespace=nowarn", patch], destination);
    if (result.exitCode !== 0) throw new DomainError(`The solution's diff does not apply: ${result.stderr.trim()}`);
  }

  async remoteUrl(name: string): Promise<string | undefined> {
    const result = await this.runner.run("git", ["remote", "get-url", "origin"], this.repoPath(name));
    return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
  }

  async topLevel(folder: string): Promise<string | undefined> {
    if (!existsSync(folder)) return undefined;
    const result = await this.runner.run("git", ["rev-parse", "--show-toplevel"], folder);
    return result.exitCode === 0 && result.stdout.trim() ? path.resolve(result.stdout.trim()) : undefined;
  }

  nameAt(folder: string): RepositoryEntry | undefined {
    return this.list().find((entry) => samePath(entry.path, folder));
  }

  list(): RepositoryEntry[] {
    const root = this.root.resolve(".");
    const mirrors = existsSync(root)
      ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, ".git")))
        .map((d): RepositoryEntry => ({ name: d.name, kind: "mirror", path: path.join(root, d.name) }))
      : [];
    const linked = (this.linked?.all() ?? []).map((l): RepositoryEntry => ({ name: l.name, kind: "linked", path: l.path }));
    return [...linked, ...mirrors];
  }

  async workingState(name: string): Promise<{ branch: string; uncommitted: number }> {
    const folder = this.repoPath(name);
    const [branch, status] = await Promise.all([
      this.runner.run("git", ["rev-parse", "--abbrev-ref", "HEAD"], folder),
      this.runner.run("git", ["status", "--porcelain"], folder),
    ]);
    const lines = status.stdout.split(/\r?\n/).filter((l) => l.trim());
    return { branch: branch.stdout.trim(), uncommitted: lines.length };
  }

  /** A linked folder first, then the clone under the mirrors root. */
  private repoPath(name: string): string {
    requireRepositoryName(name);
    return this.linked?.get(name)?.path ?? this.root.resolve(name);
  }

  /** Case-insensitive fixed-string `git grep` over tracked text files, outside lockfiles and editor or git config. */
  private async grep(name: string, options: string[], terms: string[]) {
    const args = ["grep", "-I", "-i", "-F", ...options, ...terms.flatMap((t) => ["-e", t]), "--", ".", ...NOT_CODE];
    const result = await this.runner.run("git", args, this.repoPath(name));
    // git grep exits with 1 when nothing matched.
    if (result.exitCode > 1) throw new Error(`git grep failed: ${result.stderr.trim()}`);
    return result;
  }

  private parse(output: string): CodeLocation[] {
    return output
      .split(/\r?\n/)
      .map((line) => /^(.+?):(\d+):(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ path: m[1]!, line: Number(m[2]), text: m[3]!.trim().slice(0, MAX_LINE_LENGTH) }));
  }

  /** Lines that contain more of the (lower-case) terms come first. */
  private rank(locations: CodeLocation[], lowered: string[]): CodeLocation[] {
    return locations
      .map((loc) => ({ loc, score: lowered.filter((t) => loc.text.toLowerCase().includes(t)).length }))
      .sort((a, b) => b.score - a.score)
      .map(({ loc }) => loc);
  }
}
