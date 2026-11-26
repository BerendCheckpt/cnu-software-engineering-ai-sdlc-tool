/** Where a solution has been applied. */
export interface Application {
  solutionId: string;
  repository: string;
  commit: string;
  files: string[];
  pullRequestUrl?: string;
}
