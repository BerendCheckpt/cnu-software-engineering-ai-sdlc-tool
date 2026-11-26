import type { CleanupGates } from "../../../ports/interfaces/cleanup/CleanupGates.js";
import type { ICleanupGateFactory } from "../../../ports/interfaces/cleanup/ICleanupGateFactory.js";
import type { GateRunners } from "../../interfaces/cleanup/GateRunners.js";
import { AngularTestEvaluator } from "../evaluation/AngularTestEvaluator.js";
import { NodeTestEvaluator } from "../evaluation/NodeTestEvaluator.js";
import type { SonarClient } from "../evaluation/SonarClient.js";
import { SonarScannerEvaluator } from "../evaluation/SonarScannerEvaluator.js";
import { VitestEvaluator } from "../evaluation/VitestEvaluator.js";
import { XunitEvaluator } from "../evaluation/XunitEvaluator.js";
import { DotnetVulnerableSource } from "../findings/DotnetVulnerableSource.js";
import { GitleaksSource } from "../findings/GitleaksSource.js";
import { NpmAuditSource } from "../findings/NpmAuditSource.js";
import { SonarIssueSource } from "../findings/SonarIssueSource.js";

/** The containerized gates for one clean-up run or one solution, each scanned into its own SonarQube project. */
export class ContainerGateFactory implements ICleanupGateFactory {
  constructor(private readonly runners: GateRunners, private readonly sonar: SonarClient) {}

  forRun(id: string, purpose: "cleanup" | "solution" = "cleanup"): CleanupGates {
    const projectKey = `aisdlc-${purpose}-${id}`;
    const sonarProjectUrl = this.sonar.configured ? this.sonar.projectUrl(projectKey) : undefined;
    return {
      ...(sonarProjectUrl ? { sonarProjectUrl, sonarProject: projectKey } : {}),
      evaluators: [
        new XunitEvaluator(this.runners.offline),
        new VitestEvaluator(this.runners.offline),
        new AngularTestEvaluator(this.runners.offline),
        new NodeTestEvaluator(this.runners.offline),
        new SonarScannerEvaluator(this.runners.scanner, this.sonar, projectKey),
      ],
      findingSources: [
        new SonarIssueSource(this.sonar, projectKey),
        new GitleaksSource(this.runners.offline),
        new NpmAuditSource(this.runners.online),
        new DotnetVulnerableSource(this.runners.online),
      ],
      release: async () => {
        if (!this.sonar.configured) return undefined;
        const deleted = await this.sonar.deleteProject(projectKey).catch(() => false);
        return deleted ? undefined : `Delete the SonarQube project ${projectKey} by hand; the token may not delete it.`;
      },
    };
  }
}
