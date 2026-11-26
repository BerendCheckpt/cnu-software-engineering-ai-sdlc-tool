import { existsSync } from "node:fs";
import path from "node:path";
import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import type { IFindingSource } from "../../../ports/interfaces/cleanup/IFindingSource.js";
import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";

interface NpmAudit {
  vulnerabilities?: Record<string, { severity: string; range: string; isDirect: boolean }>;
}

/** Known vulnerable npm packages. Needs the registry, so its runner is the one with network access. */
export class NpmAuditSource implements IFindingSource {
  readonly name = "npm-audit";

  constructor(private readonly runner: IProcessRunner) {}

  async collect(workspace: string): Promise<Finding[]> {
    if (!existsSync(path.join(workspace, "package-lock.json"))) return [];
    // npm audit exits with 1 when it found something; only unreadable output is a failure.
    const run = await this.runner.run("npm", ["audit", "--json"], workspace);
    let audit: NpmAudit;
    try {
      audit = JSON.parse(run.stdout) as NpmAudit;
    } catch {
      throw new Error(`npm audit failed: ${run.stderr.slice(-300)}`);
    }
    return Object.entries(audit.vulnerabilities ?? {}).map(([name, v]) => ({
      source: this.name,
      rule: `npm:${name}`,
      category: "dependency",
      severity: v.severity.toUpperCase(),
      file: "package.json",
      message: `${name} ${v.range} is vulnerable (${v.severity}${v.isDirect ? "" : ", transitive"})`,
    }));
  }
}
