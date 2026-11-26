import type { FailedCheck } from "../../../ports/interfaces/git/FailedCheck.js";
import type { ICiChecks } from "../../../ports/interfaces/git/ICiChecks.js";
import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";
import type { CiResult } from "../../../ports/types/git/CiResult.js";
import { gitHubRepository } from "../../helpers/git/gitHubRepository.js";

/** Lines kept from the end of a failed job's log: enough to see the error, few enough to stay cheap. */
const LOG_TAIL = 40;

interface Check {
  name: string;
  bucket: string;
  link?: string;
}

/**
 * Reads a pull request's checks with the GitHub CLI and the engineer's own `gh` login, once: the CLI never waits.
 * A failing check comes with the tail of its failed job log; a log that cannot be read is said so, and never stops
 * the other checks.
 */
export class GhCiChecks implements ICiChecks {
  constructor(private readonly runner: IProcessRunner) {}

  async read(workspace: string, pullRequest: string): Promise<CiResult> {
    const remote = await this.runner.run("git", ["remote", "get-url", "origin"], workspace);
    const repository = gitHubRepository(remote.stdout.trim());
    if (!repository || !/^https:\/\/github\.com\//.test(pullRequest)) {
      return { state: "unsupported", reason: `${pullRequest} is not a GitHub pull request; look at its CI by hand` };
    }
    const result = await this.runner.run("gh",
      ["pr", "checks", pullRequest, "--repo", repository, "--json", "name,bucket,link"], workspace);
    const checks = parse(result.stdout);
    if (!checks) {
      if (/no checks reported/i.test(result.stderr)) return { state: "none" };
      throw new Error(`gh pr checks failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
    }
    const counted = checks.filter((c) => c.bucket !== "skipping");
    if (!counted.length) return { state: "none" };
    const failed = counted.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
    if (failed.length) {
      const failing: FailedCheck[] = [];
      for (const check of failed) failing.push({ name: check.name, log: await this.log(workspace, repository, check) });
      return { state: "failing", failing };
    }
    return { state: counted.some((c) => c.bucket === "pending") ? "pending" : "passing" };
  }

  private async log(workspace: string, repository: string, check: Check): Promise<string> {
    const job = /\/job\/(\d+)/.exec(check.link ?? "")?.[1];
    if (!job) return `No job log found; see ${check.link ?? "the pull request's checks"}`;
    const result = await this.runner.run("gh", ["run", "view", "--repo", repository, "--job", job, "--log-failed"], workspace);
    if (result.exitCode !== 0) return `The job log could not be read (${result.stderr.trim().split("\n")[0]}); see ${check.link}`;
    // Each line starts with the job and step name; the step name stays, it says where the failure is.
    return result.stdout.trimEnd().split(/\r?\n/).slice(-LOG_TAIL).join("\n");
  }
}

function parse(stdout: string): Check[] | undefined {
  if (!stdout.trim()) return undefined;
  try {
    const value = JSON.parse(stdout) as unknown;
    return Array.isArray(value) ? value as Check[] : undefined;
  } catch {
    return undefined;
  }
}
