import { readdirSync } from "node:fs";
import type { IFormatter } from "../../../ports/interfaces/cleanup/IFormatter.js";
import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";

const DOTNET_PROJECT = /\.(slnx?|csproj)$/i;

/** `dotnet format`: whitespace, code style and analyzer fixes the repository's own `.editorconfig` asks for. */
export class DotnetFormatter implements IFormatter {
  readonly name = "dotnet format";

  constructor(private readonly runner: IProcessRunner) {}

  async apply(workspace: string): Promise<boolean> {
    if (!readdirSync(workspace).some((f) => DOTNET_PROJECT.test(f))) return false;
    const run = await this.runner.run("dotnet", ["format", "--no-restore"], workspace);
    if (run.exitCode !== 0) throw new Error(`dotnet format failed: ${run.stderr.slice(-300)}`);
    return true;
  }
}
