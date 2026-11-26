import { createHash } from "node:crypto";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for", "from", "how", "i", "in", "is", "it", "me",
  "my", "of", "on", "or", "please", "should", "so", "that", "the", "this", "to", "we", "what", "when", "with", "you",
]);

const SUFFIXES = ["ing", "ed", "es", "s"];

/**
 * Turns free text into comparable terms, without a model.
 * The same text always gives the same terms and the same hash.
 */
export class TextNormalizer {
  terms(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9#+.]+/)
      .map((word) => word.replace(/^\.+|\.+$/g, ""))
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
      .map((word) => this.stem(word));
  }

  normalize(text: string): string {
    return this.terms(text).join(" ");
  }

  hash(text: string): string {
    return createHash("sha256").update(this.normalize(text)).digest("hex");
  }

  private stem(word: string): string {
    const suffix = SUFFIXES.find((s) => word.length > s.length + 3 && word.endsWith(s));
    return suffix ? word.slice(0, -suffix.length) : word;
  }
}
