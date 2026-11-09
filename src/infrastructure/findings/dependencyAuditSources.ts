import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Finding } from "../../domain/cleanup.js";
import type { IFindingSource, IProcessRunner } from "../../ports/services.js";

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

interface DotnetPackages {
  projects?: {
    path: string;
    frameworks?: {
      topLevelPackages?: VulnerablePackage[];
      transitivePackages?: VulnerablePackage[];
    }[];
  }[];
}

interface VulnerablePackage {
  id: string;
  resolvedVersion: string;
  vulnerabilities?: { severity: string }[];
}

const DOTNET_PROJECT = /\.(slnx?|csproj)$/i;

/** Known vulnerable NuGet packages, from `dotnet list package --vulnerable`. Needs nuget.org. */
export class DotnetVulnerableSource implements IFindingSource {
  readonly name = "dotnet-vulnerable";

  constructor(private readonly runner: IProcessRunner) {}

  async collect(workspace: string): Promise<Finding[]> {
    if (!readdirSync(workspace).some((f) => DOTNET_PROJECT.test(f))) return [];
    const run = await this.runner.run("dotnet",
      ["list", "package", "--vulnerable", "--include-transitive", "--format", "json"], workspace);
    let report: DotnetPackages;
    try {
      report = JSON.parse(run.stdout) as DotnetPackages;
    } catch {
      throw new Error(`dotnet list package failed: ${run.stderr.slice(-300)}`);
    }
    return (report.projects ?? []).flatMap((project) => (project.frameworks ?? [])
      .flatMap((f) => [...(f.topLevelPackages ?? []), ...(f.transitivePackages ?? [])])
      .filter((p) => p.vulnerabilities?.length)
      .map((p): Finding => ({
        source: this.name,
        rule: `nuget:${p.id}`,
        category: "dependency",
        severity: (p.vulnerabilities?.[0]?.severity ?? "unknown").toUpperCase(),
        file: path.posix.relative("/work", project.path.replaceAll("\\", "/")),
        message: `${p.id} ${p.resolvedVersion} is vulnerable`,
      })));
  }
}
