/** `file:line`, or just the file when the line is not known. */
export function findingLocation(f: { file: string; line?: number }): string {
  return `${f.file}${f.line ? `:${f.line}` : ""}`;
}
