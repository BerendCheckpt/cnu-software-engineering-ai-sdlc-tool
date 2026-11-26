/** The host of a git remote URL, or undefined for a local path. */
export function hostOf(remote: string): string | undefined {
  const scp = /^[^@/\s]+@([^:/\s]+):/.exec(remote);
  if (scp) return scp[1];
  try {
    // A local path such as C:/repos/x parses as a URL with an empty host.
    return new URL(remote).hostname || undefined;
  } catch {
    return undefined;
  }
}
