import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Finding } from "../../domain/cleanup.js";
import type { IFindingSource, IProcessRunner } from "../../ports/services.js";

interface Leak {
  RuleID: string;
  Description: string;
  File: string;
  StartLine: number;
}

/**
 * Secrets in the working tree, found by gitleaks in a container without network. Only the rule, file and line are
 * kept: the report is written with `--redact`, and the matched text is never read.
 */
export class GitleaksSource implements IFindingSource {
  readonly name = "gitleaks";

  constructor(private readonly runner: IProcessRunner) {}

  async collect(workspace: string): Promise<Finding[]> {
    const report = path.join(workspace, ".aisdlc", "gitleaks.json");
    const run = await this.runner.run("gitleaks", [
      "dir", workspace, "--report-format", "json", "--report-path", report, "--redact", "--exit-code", "0", "--no-banner",
    ], workspace);
    if (run.exitCode !== 0 || !existsSync(report)) throw new Error(`gitleaks failed: ${run.stderr.slice(-300)}`);
    const leaks = JSON.parse(readFileSync(report, "utf8")) as Leak[];
    return leaks
      .filter((l) => !l.File.includes("/.aisdlc/") && !l.File.startsWith(".aisdlc/"))
      .map((l) => ({
        source: this.name,
        rule: l.RuleID,
        category: "security",
        severity: "CRITICAL",
        file: l.File.replace(/^\/work\//, "").replaceAll("\\", "/"),
        line: l.StartLine,
        message: l.Description,
      }));
  }
}
