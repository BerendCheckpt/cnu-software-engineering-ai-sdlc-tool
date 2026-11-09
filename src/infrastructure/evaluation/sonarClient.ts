export interface SonarSettings {
  hostUrl?: string;
  /** Read from the environment by the composition root. Never logged, never put in a digest or report. */
  token?: string;
}

export interface SonarIssue {
  rule: string;
  /** The older severity (BLOCKER, CRITICAL, MAJOR, MINOR, INFO); `impacts` holds the current ones. */
  severity: string;
  /** SonarQube 10.2 and later: one severity per software quality it affects. */
  impacts?: { softwareQuality: string; severity: string }[];
  type: string;
  component: string;
  line?: number;
  message: string;
}

export interface SonarHotspot {
  ruleKey: string;
  vulnerabilityProbability: string;
  component: string;
  line?: number;
  message: string;
}

const METRICS = "bugs,vulnerabilities,security_hotspots,code_smells,coverage,duplicated_lines_density";
const PAGE_SIZE = 500;
const MAX_PAGES = 10;

/** SonarQube refused the call for lack of permission. */
export class SonarPermissionError extends Error {}

/** The few SonarQube Web API calls aisdlc needs. */
export class SonarClient {
  constructor(private readonly settings: SonarSettings, private readonly http: typeof fetch = fetch) {}

  get configured(): boolean {
    return Boolean(this.settings.hostUrl && this.settings.token);
  }

  get hostUrl(): string {
    return this.settings.hostUrl ?? "";
  }

  /** Where a human sees the project's open issues. */
  projectUrl(projectKey: string): string | undefined {
    return this.settings.hostUrl ? `${this.settings.hostUrl}/project/issues?id=${encodeURIComponent(projectKey)}&resolved=false` : undefined;
  }

  async qualityGate(projectKey: string): Promise<string> {
    const body = await this.get<{ projectStatus: { status: string } }>(
      `/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`);
    return body.projectStatus.status;
  }

  async measures(projectKey: string): Promise<Map<string, string>> {
    const body = await this.get<{ component: { measures: { metric: string; value: string }[] } }>(
      `/api/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=${METRICS}`);
    return new Map(body.component.measures.map((m) => [m.metric, m.value]));
  }

  async openIssues(projectKey: string): Promise<SonarIssue[]> {
    return this.pages<SonarIssue>("issues",
      `/api/issues/search?componentKeys=${encodeURIComponent(projectKey)}&resolved=false&ps=${PAGE_SIZE}`);
  }

  async hotspotsToReview(projectKey: string): Promise<SonarHotspot[]> {
    return this.pages<SonarHotspot>("hotspots",
      `/api/hotspots/search?project=${encodeURIComponent(projectKey)}&status=TO_REVIEW&ps=${PAGE_SIZE}`);
  }

  /** Needs a token that may administer the project. Returns false when SonarQube refuses. */
  async deleteProject(projectKey: string): Promise<boolean> {
    const response = await this.http(`${this.settings.hostUrl}/api/projects/delete?project=${encodeURIComponent(projectKey)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.settings.token}` },
      signal: AbortSignal.timeout(30_000),
    });
    return response.ok;
  }

  private async pages<T>(field: "issues" | "hotspots", route: string): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.get<Record<string, unknown>>(`${route}&p=${page}`);
      const items = (body[field] ?? []) as T[];
      all.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    return all;
  }

  private async get<T>(route: string): Promise<T> {
    const response = await this.http(`${this.settings.hostUrl}${route}`, {
      headers: { Authorization: `Bearer ${this.settings.token}` },
      signal: AbortSignal.timeout(30_000),
    });
    // The status only: a response body could echo request details.
    const message = `SonarQube answered ${response.status} for ${route.split("?")[0]}.`;
    if (response.status === 401 || response.status === 403) throw new SonarPermissionError(message);
    if (!response.ok) throw new Error(message);
    return (await response.json()) as T;
  }
}
