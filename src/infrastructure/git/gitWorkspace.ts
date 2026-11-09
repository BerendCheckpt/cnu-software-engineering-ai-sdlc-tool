import { appendFileSync } from "node:fs";
import path from "node:path";
import type { IGitWorkspace, IProcessRunner } from "../../ports/services.js";

const BRANCH = /^[A-Za-z0-9._/-]+$/;
const SHA = /^[0-9a-f]{7,40}$/;
/** Tool output inside the workspace that must never end up in a commit. */
const EXCLUDED = [".aisdlc/", ".scannerwork/", ".sonarqube/"];

/** The clean-up checkout, driven through git on the host with `execFile`. */
export class GitWorkspace implements IGitWorkspace {
  constructor(private readonly runner: IProcessRunner) {}

  async prepare(workspace: string, branch: string): Promise<{ baseBranch: string; baseSha: string }> {
    if (!BRANCH.test(branch)) throw new Error(`Not a valid branch name: ${branch}`);
    // The workspace was cloned from the mirror; pushes go to the repository the mirror came from.
    const mirror = await this.git(workspace, "remote", "get-url", "origin");
    const upstream = await this.runner.run("git", ["remote", "get-url", "origin"], mirror);
    if (upstream.exitCode === 0 && upstream.stdout.trim()) {
      await this.git(workspace, "remote", "set-url", "origin", upstream.stdout.trim());
    }
    const baseBranch = await this.git(workspace, "rev-parse", "--abbrev-ref", "HEAD");
    await this.git(workspace, "switch", "--quiet", "--create", branch);
    appendFileSync(path.join(workspace, ".git", "info", "exclude"), `\n${EXCLUDED.join("\n")}\n`);
    return { baseBranch, baseSha: await this.head(workspace) };
  }

  head(workspace: string): Promise<string> {
    return this.git(workspace, "rev-parse", "HEAD");
  }

  async diffSince(workspace: string, since: string): Promise<string> {
    await this.git(workspace, "add", "--all");
    return this.git(workspace, "diff", "--cached", "--no-color", "--no-ext-diff", this.sha(since), "--");
  }

  async commit(workspace: string, message: string): Promise<string> {
    await this.git(workspace, "add", "--all");
    // Nothing staged happens when the changes were already committed in the workspace; HEAD holds them then.
    const staged = await this.runner.run("git", ["diff", "--cached", "--quiet"], workspace);
    if (staged.exitCode !== 0) await this.git(workspace, "commit", "--quiet", "--message", message);
    return this.head(workspace);
  }

  /** Throws away everything since `sha` in the workspace, including new files. Ignored files stay. */
  async resetTo(workspace: string, sha: string): Promise<void> {
    await this.git(workspace, "reset", "--quiet", "--hard", this.sha(sha));
    await this.git(workspace, "clean", "--quiet", "--force", "-d");
  }

  async push(workspace: string, branch: string): Promise<void> {
    if (!BRANCH.test(branch)) throw new Error(`Not a valid branch name: ${branch}`);
    await this.git(workspace, "push", "--quiet", "--set-upstream", "origin", `HEAD:refs/heads/${branch}`);
  }

  private sha(value: string): string {
    if (!SHA.test(value)) throw new Error(`Not a commit id: ${value}`);
    return value;
  }

  private async git(cwd: string, ...args: string[]): Promise<string> {
    const result = await this.runner.run("git", args, cwd);
    if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  }
}
