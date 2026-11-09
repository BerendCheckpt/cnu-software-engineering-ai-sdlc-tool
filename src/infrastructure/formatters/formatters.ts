import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { IFormatter, IProcessRunner } from "../../ports/services.js";

const DOTNET_PROJECT = /\.(slnx?|csproj)$/i;
const ESLINT_CONFIG = /^(eslint\.config\.(js|mjs|cjs|ts)|\.eslintrc(\.(js|cjs|json|ya?ml))?)$/;

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

/** `eslint --fix` with the repository's own configuration and eslint version. */
export class EslintFormatter implements IFormatter {
  readonly name = "eslint --fix";

  constructor(private readonly runner: IProcessRunner) {}

  async apply(workspace: string): Promise<boolean> {
    const entry = path.join(workspace, "node_modules", "eslint", "bin", "eslint.js");
    if (!existsSync(entry) || !readdirSync(workspace).some((f) => ESLINT_CONFIG.test(f))) return false;
    // Exit code 1 means problems are left that eslint cannot fix itself; those stay findings.
    const run = await this.runner.run(process.execPath, [entry, ".", "--fix"], workspace);
    if (run.exitCode > 1) throw new Error(`eslint failed: ${run.stderr.slice(-300)}`);
    return true;
  }
}
