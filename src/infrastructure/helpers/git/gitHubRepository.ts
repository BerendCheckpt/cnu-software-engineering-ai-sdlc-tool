import { hostOf } from "./hostOf.js";

/** `owner/name` of a GitHub remote, https or ssh; undefined for anything else. */
export function gitHubRepository(remote: string): string | undefined {
  if (hostOf(remote) !== "github.com") return undefined;
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote);
  return match ? `${match[1]}/${match[2]}` : undefined;
}
