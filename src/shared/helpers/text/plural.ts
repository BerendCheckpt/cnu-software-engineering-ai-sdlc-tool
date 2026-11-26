/** `1 finding`, `2 findings`: the count with the word in singular or plural. */
export function plural(count: number, word: string, plural = `${word}s`): string {
  return `${count} ${count === 1 ? word : plural}`;
}
