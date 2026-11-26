/** The first line of a tool's output, without surrounding whitespace. */
export function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? "";
}
