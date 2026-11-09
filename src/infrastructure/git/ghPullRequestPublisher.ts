import type { IProcessRunner, IPullRequestPublisher } from "../../ports/services.js";
import { hostOf } from "./remotes.js";

/**
 * Opens the pull request with the GitHub CLI and the engineer's own `gh` login. Other hosts (Azure DevOps) get the
 * branch pushed and a note saying where to open the pull request by hand.
 */
export class GhPullRequestPublisher implements IPullRequestPublisher {
  constructor(private readonly runner: IProcessRunner) {}

  async open(workspace: string, branch: string, baseBranch: string, title: string, bodyFile: string): Promise<string> {
    const remote = await this.runner.run("git", ["remote", "get-url", "origin"], workspace);
    const host = hostOf(remote.stdout.trim());
    if (host !== "github.com") {
      return `Pushed ${branch}. Open the pull request into ${baseBranch} on ${host || "the remote"} by hand, ` +
        `with ${bodyFile} as its description.`;
    }
    const run = await this.runner.run("gh",
      ["pr", "create", "--head", branch, "--base", baseBranch, "--title", title, "--body-file", bodyFile], workspace);
    if (run.exitCode !== 0) throw new Error(`gh pr create failed: ${run.stderr.trim()}`);
    return run.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  }
}
