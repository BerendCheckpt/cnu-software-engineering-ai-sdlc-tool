/** The last result of each kind, in the order the kinds first appear; `results` is oldest first. */
export function latestPerKind<T extends { kind: string }>(results: Iterable<T>): T[] {
  const latest = new Map<string, T>();
  for (const result of results) latest.set(result.kind, result);
  return [...latest.values()];
}
