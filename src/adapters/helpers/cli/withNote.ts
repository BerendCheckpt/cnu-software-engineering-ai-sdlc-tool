/** `text` with an optional note (such as uncommitted changes in a linked folder) on the line above it. */
export function withNote(note: string | undefined, text: string): string {
  return note ? `${note}\n${text}` : text;
}
