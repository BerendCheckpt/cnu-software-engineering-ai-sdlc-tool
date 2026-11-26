/** The error text for a tool that failed: its name and the last `tail` characters of what it printed. */
export function toolFailure(tool: string, output: string, tail = 300): string {
  return `${tool} failed: ${output.slice(-tail)}`;
}
