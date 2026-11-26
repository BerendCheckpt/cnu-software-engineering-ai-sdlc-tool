import { existsSync } from "node:fs";
import path from "node:path";
import type { IDependencyRestorer } from "../../../ports/interfaces/cleanup/IDependencyRestorer.js";
import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";
import { toolFailure } from "../../../shared/helpers/process/toolFailure.js";
import { hasDotnetProject } from "../../../shared/helpers/workspace/hasDotnetProject.js";

/**
 * Restores npm and NuGet packages in a container that may reach the registries. Package install scripts are not
 * run (`--ignore-scripts`): they are code from the internet, and nothing in a clean-up needs them.
 */
export class DependencyRestorer implements IDependencyRestorer {
  constructor(private readonly runner: IProcessRunner) {}

  async restore(workspace: string): Promise<void> {
    if (existsSync(path.join(workspace, "package-lock.json"))) {
      await this.require("npm ci", this.runner.run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], workspace));
    }
    if (hasDotnetProject(workspace)) {
      await this.require("dotnet restore", this.runner.run("dotnet", ["restore"], workspace));
    }
  }

  private async require(what: string, run: ReturnType<IProcessRunner["run"]>): Promise<void> {
    const result = await run;
    if (result.exitCode !== 0) throw new Error(toolFailure(what, result.stderr));
  }
}
