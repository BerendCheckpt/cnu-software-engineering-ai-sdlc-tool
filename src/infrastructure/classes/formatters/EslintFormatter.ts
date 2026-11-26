import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { IFormatter } from "../../../ports/interfaces/cleanup/IFormatter.js";
import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";

const ESLINT_CONFIG = /^(eslint\.config\.(js|mjs|cjs|ts)|\.eslintrc(\.(js|cjs|json|ya?ml))?)$/;

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
