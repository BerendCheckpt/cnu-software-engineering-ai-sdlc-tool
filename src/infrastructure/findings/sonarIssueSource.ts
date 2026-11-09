import type { Finding, FindingCategory } from "../../domain/cleanup.js";
import type { IFindingSource } from "../../ports/services.js";
import { normalizeSeverity, SEVERITIES, type Severity } from "../../domain/quality.js";
import { SonarPermissionError, type SonarClient, type SonarHotspot, type SonarIssue } from "../evaluation/sonarClient.js";

/** Open issues and hotspots to review of the run's SonarQube project, read after the scan gate ran. */
export class SonarIssueSource implements IFindingSource {
  readonly name = "sonar";
  private missing: string[] = [];

  constructor(private readonly client: SonarClient, private readonly projectKey: string) {}

  limitations(): string[] {
    return this.missing;
  }

  async collect(): Promise<Finding[]> {
    if (!this.client.configured) return [];
    const [issues, hotspots] = await Promise.all([this.client.openIssues(this.projectKey), this.hotspots()]);
    return [
      ...issues.map((i): Finding => ({
        source: this.name,
        rule: i.rule,
        category: categoryOf(i.type, i.severity),
        severity: severityOf(i),
        file: this.fileOf(i.component),
        ...(i.line ? { line: i.line } : {}),
        message: i.message,
      })),
      ...hotspots.map((h): Finding => ({
        source: this.name,
        rule: h.ruleKey,
        category: "security",
        severity: h.vulnerabilityProbability,
        file: this.fileOf(h.component),
        ...(h.line ? { line: h.line } : {}),
        message: h.message,
      })),
    ];
  }

  /**
   * Hotspots need more than an analysis token (`sqa_`) may do. Without that permission they are left out of every
   * measurement alike, so comparisons stay fair, and the plan says they were not read.
   */
  private async hotspots(): Promise<SonarHotspot[]> {
    this.missing = [];
    try {
      return await this.client.hotspotsToReview(this.projectKey);
    } catch (error) {
      if (!(error instanceof SonarPermissionError)) throw error;
      this.missing = ["SonarQube security hotspots were not read: the token may not browse them (use a user token)."];
      return [];
    }
  }

  /** A component is `<projectKey>:<path>`. */
  private fileOf(component: string): string {
    return component.startsWith(`${this.projectKey}:`) ? component.slice(this.projectKey.length + 1) : component;
  }
}

/** The most severe impact; issues from servers without impacts keep their older severity, mapped. */
function severityOf(issue: SonarIssue): Severity {
  const all = (issue.impacts?.length ? issue.impacts.map((i) => i.severity) : [issue.severity]).map(normalizeSeverity);
  return SEVERITIES.find((s) => all.includes(s)) ?? "INFO";
}

function categoryOf(type: string, severity: string): FindingCategory {
  if (type === "VULNERABILITY" || type === "SECURITY_HOTSPOT") return "security";
  if (type === "BUG") return "bug";
  return severity === "MINOR" || severity === "INFO" ? "readability" : "maintainability";
}
