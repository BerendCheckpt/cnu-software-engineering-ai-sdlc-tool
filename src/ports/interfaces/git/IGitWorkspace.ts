/** The clean-up's writable git checkout. Pushing is the only call that reaches outside the machine. */
export interface IGitWorkspace {
  /**
   * Creates the branch and points `origin` at the mirror's own remote. Refuses when the branch already exists in the
   * mirror or on the remote: a branch there means a clean-up or migration already ran on this data. `note` says what
   * could not be checked.
   */
  prepare(workspace: string, branch: string): Promise<{ baseBranch: string; baseSha: string; note?: string }>;
  head(workspace: string): Promise<string>;
  /** Every change since `since`, committed or not, including new files. */
  diffSince(workspace: string, since: string): Promise<string>;
  commit(workspace: string, message: string): Promise<string>;
  resetTo(workspace: string, sha: string): Promise<void>;
  push(workspace: string, branch: string): Promise<void>;
  /**
   * The branch the PR goes into: `base` when it is on the remote, else the remote's default branch. `note` says
   * when it changed or could not be checked.
   */
  resolveBase(workspace: string, base: string): Promise<{ base: string; note?: string }>;
}
