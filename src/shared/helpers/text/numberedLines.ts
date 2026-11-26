/** Lines `first` to `last` (1-based, inclusive), each prefixed with its line number: `12: const x = 1;`. */
export function numberedLines(lines: string[], first: number, last: number): string {
  return lines.slice(first - 1, last).map((l, i) => `${first + i}: ${l}`).join("\n");
}
