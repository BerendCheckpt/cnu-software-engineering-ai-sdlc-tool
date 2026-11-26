import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { IEvaluator } from "../../../ports/interfaces/evaluation/IEvaluator.js";
import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";
import type { ProcessResult } from "../../../ports/interfaces/process/ProcessResult.js";
import { sonarResult } from "../../helpers/evaluation/sonarResult.js";
import { reachableFromContainer } from "../../helpers/process/reachableFromContainer.js";
import type { SonarClient } from "./SonarClient.js";

const DOTNET_PROJECT = /\.(slnx?|csproj)$/i;

const SCAN_TIMEOUT_MS = 15 * 60_000;

/**
 * Scans the workspace into its own SonarQube project on the existing server, then reads that project's quality
 * gate. A project per clean-up run works on every SonarQube edition, and never touches the team's own project.
 *
 * The runner is a container with network access and `SONAR_TOKEN` passed by name, so the token never appears in a
 * host argument. .NET projects use the SonarScanner for .NET image (`scan-dotnet`: begin, build, end); everything
 * else uses the generic scanner.
 */
export class SonarScannerEvaluator implements IEvaluator {
  readonly kind = "sonar" as const;

  constructor(
    private readonly runner: IProcessRunner,
    private readonly client: SonarClient,
    private readonly projectKey: string,
  ) {}

  async evaluate(workspace: string): Promise<EvaluationResult> {
    if (!this.client.configured) return EvaluationResult.skipped(this.kind, "SONAR_HOST_URL or SONAR_TOKEN is not set");
    const server = reachableFromContainer(this.client.hostUrl);
    const scan = this.isDotnetOnly(workspace)
      ? await this.runner.run("scan-dotnet", [this.projectKey, server], workspace, SCAN_TIMEOUT_MS)
      : await this.scanGeneric(workspace, server);
    try {
      return await sonarResult(this.client, this.projectKey);
    } catch (error) {
      if (scan.exitCode !== 0) return new EvaluationResult(this.kind, false, `scan failed: ${scan.stderr.slice(-500)}`);
      throw error;
    }
  }

  private scanGeneric(workspace: string, server: string): Promise<ProcessResult> {
    return this.runner.run("sonar-scanner", [
      `-Dsonar.projectKey=${this.projectKey}`,
      // The address is not a secret; the token still only travels in the environment.
      `-Dsonar.host.url=${server}`,
      "-Dsonar.sources=.",
      "-Dsonar.exclusions=**/node_modules/**,.aisdlc/**,**/dist/**,**/coverage/**",
      `-Dsonar.working.directory=${path.join(workspace, ".aisdlc", "scannerwork")}`,
      // Waits until the server has processed the analysis, so the gate read below is this analysis's.
      "-Dsonar.qualitygate.wait=true",
      "-Dsonar.qualitygate.timeout=600",
    ], workspace, SCAN_TIMEOUT_MS);
  }

  private isDotnetOnly(workspace: string): boolean {
    return !existsSync(path.join(workspace, "package.json")) && readdirSync(workspace).some((f) => DOTNET_PROJECT.test(f));
  }
}
