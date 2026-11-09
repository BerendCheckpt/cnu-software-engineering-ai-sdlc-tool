import type { CleanupGates, ICleanupGateFactory, IProcessRunner } from "../../ports/services.js";
import { AngularTestEvaluator } from "../evaluation/angularTestEvaluator.js";
import type { SonarClient } from "../evaluation/sonarClient.js";
import { SonarScannerEvaluator } from "../evaluation/sonarScannerEvaluator.js";
import { VitestEvaluator } from "../evaluation/vitestEvaluator.js";
import { XunitEvaluator } from "../evaluation/xunitEvaluator.js";
import { DotnetVulnerableSource, NpmAuditSource } from "../findings/dependencyAuditSources.js";
import { GitleaksSource } from "../findings/gitleaksSource.js";
import { SonarIssueSource } from "../findings/sonarIssueSource.js";

export interface GateRunners {
  /** No network: tests, builds, gitleaks. */
  offline: IProcessRunner;
  /** Network for the package registries: dependency audits. */
  online: IProcessRunner;
  /** Network and the SonarQube variables: the scanner. */
  scanner: IProcessRunner;
}

/** The containerized gates for one clean-up run or one solution, each scanned into its own SonarQube project. */
export class ContainerGateFactory implements ICleanupGateFactory {
  constructor(private readonly runners: GateRunners, private readonly sonar: SonarClient) {}

  forRun(id: string, purpose: "cleanup" | "solution" = "cleanup"): CleanupGates {
    const projectKey = `aisdlc-${purpose}-${id}`;
    const sonarProjectUrl = this.sonar.configured ? this.sonar.projectUrl(projectKey) : undefined;
    return {
      ...(sonarProjectUrl ? { sonarProjectUrl } : {}),
      evaluators: [
        new XunitEvaluator(this.runners.offline),
        new VitestEvaluator(this.runners.offline),
        new AngularTestEvaluator(this.runners.offline),
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
