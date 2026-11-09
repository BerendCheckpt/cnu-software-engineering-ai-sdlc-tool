import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { IDependencyRestorer, IProcessRunner } from "../../ports/services.js";

const DOTNET_PROJECT = /\.(slnx?|csproj)$/i;

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
    if (readdirSync(workspace).some((f) => DOTNET_PROJECT.test(f))) {
      await this.require("dotnet restore", this.runner.run("dotnet", ["restore"], workspace));
    }
  }

  private async require(what: string, run: ReturnType<IProcessRunner["run"]>): Promise<void> {
    const result = await run;
    if (result.exitCode !== 0) throw new Error(`${what} failed: ${result.stderr.slice(-300)}`);
  }
}
