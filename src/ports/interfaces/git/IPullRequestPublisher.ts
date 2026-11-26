/** Opens the pull request for a pushed branch; returns its URL, or what the engineer has to do by hand. */
export interface IPullRequestPublisher {
  open(workspace: string, branch: string, baseBranch: string, title: string, bodyFile: string): Promise<string>;
}
