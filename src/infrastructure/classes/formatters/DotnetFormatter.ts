import type { IFormatter } from "../../../ports/interfaces/cleanup/IFormatter.js";
import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";
import { toolFailure } from "../../../shared/helpers/process/toolFailure.js";
import { hasDotnetProject } from "../../../shared/helpers/workspace/hasDotnetProject.js";

/** `dotnet format`: whitespace, code style and analyzer fixes the repository's own `.editorconfig` asks for. */
export class DotnetFormatter implements IFormatter {
  readonly name = "dotnet format";

  constructor(private readonly runner: IProcessRunner) {}

  async apply(workspace: string): Promise<boolean> {
    if (!hasDotnetProject(workspace)) return false;
    const run = await this.runner.run("dotnet", ["format", "--no-restore"], workspace);
    if (run.exitCode !== 0) throw new Error(toolFailure("dotnet format", run.stderr));
    return true;
  }
}
