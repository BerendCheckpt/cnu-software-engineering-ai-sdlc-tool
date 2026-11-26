import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { IEvaluator } from "../../../ports/interfaces/evaluation/IEvaluator.js";
import { sonarResult } from "../../helpers/evaluation/sonarResult.js";
import type { SonarSettings } from "../../interfaces/evaluation/SonarSettings.js";
import { SonarClient } from "./SonarClient.js";

/**
 * Reads the quality gate and key measures of the workspace's SonarQube project from the existing server.
 * It reads the latest analysis and does not run the scanner itself (see ADR 0005); the clean-up uses
 * `SonarScannerEvaluator`, which does.
 */
export class SonarEvaluator implements IEvaluator {
  readonly kind = "sonar" as const;
  private readonly client: SonarClient;

  constructor(settings: SonarSettings, http: typeof fetch = fetch) {
    this.client = new SonarClient(settings, http);
  }

  async evaluate(workspace: string): Promise<EvaluationResult> {
    if (!this.client.configured) return EvaluationResult.skipped(this.kind, "SONAR_HOST_URL or SONAR_TOKEN is not set");
    const projectKey = this.projectKey(workspace);
    if (!projectKey) return EvaluationResult.skipped(this.kind, "no sonar.projectKey in sonar-project.properties");
    return sonarResult(this.client, projectKey);
  }

  private projectKey(workspace: string): string | undefined {
    const file = path.join(workspace, "sonar-project.properties");
    if (!existsSync(file)) return undefined;
    return /^sonar\.projectKey\s*=\s*(.+)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim();
  }
}
