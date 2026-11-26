/**
 * Splits a line into words the way a user expects, without a shell: spaces separate, and single or double quotes
 * keep spaces together. Backslashes are kept as they are, because Windows paths use them.
 */
export function tokenize(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: string | undefined;
  let started = false;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) throw new Error(`Missing closing ${quote}.`);
  if (started) words.push(current);
  return words;
}
