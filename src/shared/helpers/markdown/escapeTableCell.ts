/** Makes text safe for one Markdown table cell: line breaks become spaces and pipes are escaped. */
export function escapeTableCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}
