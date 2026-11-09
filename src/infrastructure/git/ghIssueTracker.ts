import type { IIssueTracker, IProcessRunner } from "../../ports/services.js";
import { gitHubRepository, hostOf } from "./remotes.js";

/**
 * Opens the escalation issue with the GitHub CLI and the engineer's own `gh` login, on the host. A repository that
 * is not on GitHub, or a `gh` that fails, gets a note instead: the issue text is already in `bodyFile`.
 */
export class GhIssueTracker implements IIssueTracker {
  constructor(private readonly runner: IProcessRunner, private readonly cwd: string) {}

  async open(remoteUrl: string | undefined, title: string, bodyFile: string): Promise<string> {
    const repository = remoteUrl ? gitHubRepository(remoteUrl) : undefined;
    if (!repository) {
      const where = remoteUrl ? hostOf(remoteUrl) ?? remoteUrl : "the repository";
      return `Not a GitHub repository: open an issue on ${where} by hand, with ${bodyFile} as its text.`;
    }
    const run = await this.runner.run("gh",
      ["issue", "create", "--repo", repository, "--title", title, "--body-file", bodyFile], this.cwd);
    if (run.exitCode !== 0) {
      return `gh issue create failed (${run.stderr.trim().split(/\r?\n/)[0] ?? "no message"}): ` +
        `open an issue on ${repository} by hand, with ${bodyFile} as its text.`;
    }
    return run.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  }
}
