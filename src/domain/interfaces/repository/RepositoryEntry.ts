/** Where a repository comes from: a clone aisdlc made, or a folder the engineer linked. */
export interface RepositoryEntry {
  name: string;
  kind: "mirror" | "linked";
  path: string;
}
