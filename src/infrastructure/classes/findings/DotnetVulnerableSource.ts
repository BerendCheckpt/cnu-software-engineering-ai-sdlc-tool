import path from "node:path";
import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import type { IFindingSource } from "../../../ports/interfaces/cleanup/IFindingSource.js";
import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";
import { toolFailure } from "../../../shared/helpers/process/toolFailure.js";
import { hasDotnetProject } from "../../../shared/helpers/workspace/hasDotnetProject.js";

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

/** Known vulnerable NuGet packages, from `dotnet list package --vulnerable`. Needs nuget.org. */
export class DotnetVulnerableSource implements IFindingSource {
  readonly name = "dotnet-vulnerable";

  constructor(private readonly runner: IProcessRunner) {}

  async collect(workspace: string): Promise<Finding[]> {
    if (!hasDotnetProject(workspace)) return [];
    const run = await this.runner.run("dotnet",
      ["list", "package", "--vulnerable", "--include-transitive", "--format", "json"], workspace);
    let report: DotnetPackages;
    try {
      report = JSON.parse(run.stdout) as DotnetPackages;
    } catch {
      throw new Error(toolFailure("dotnet list package", run.stderr));
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
