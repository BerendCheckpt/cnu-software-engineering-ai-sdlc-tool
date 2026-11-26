/** An FTS5 query matching any of the terms as a prefix. Each term is quoted, so it is never read as syntax. */
export function ftsAnyOf(terms: string[]): string | undefined {
  const quoted = [...new Set(terms)].filter(Boolean).map((t) => `"${t.replaceAll('"', '""')}"*`);
  return quoted.length ? quoted.join(" OR ") : undefined;
}
