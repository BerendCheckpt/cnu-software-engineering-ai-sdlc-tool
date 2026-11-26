/** The first eight characters of a commit sha or id, as people quote them. */
export function shortSha(sha: string): string {
  return sha.slice(0, 8);
}
