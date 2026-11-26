/** The last line of a tool's output, without surrounding whitespace; `gh` prints the URL it created there. */
export function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).at(-1) ?? "";
}
