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
