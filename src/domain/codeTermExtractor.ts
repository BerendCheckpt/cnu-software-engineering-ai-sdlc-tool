const CODE_SPAN = /`([^`\n]{3,60})`/g;
const PASCAL_CASE = /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/;
// C# drops the suffix where an attribute is used: `ProviderAliasAttribute` is written `[ProviderAlias(...)]`.
const ATTRIBUTE = /^(\w{6,})Attribute$/;

/**
 * Pulls API names out of a documentation section, such as `BinaryFormatter` or `HttpClient.Timeout`, so they can
 * be searched for in code. No model: code spans and PascalCase words are what documentation uses for APIs.
 * Common terms, which every project of a stack contains, are never returned.
 */
export class CodeTermExtractor {
  private readonly common: Set<string>;

  constructor(commonTerms: string[] = [], private readonly maxTerms = 5) {
    this.common = new Set(commonTerms.map((t) => t.toLowerCase()));
  }

  /** At most `maxTerms` terms, leaving out the configured common terms and `ignored` (lower case). */
  extract(text: string, ignored: ReadonlySet<string> = new Set()): string[] {
    return this.all(text).filter((t) => !ignored.has(t.toLowerCase())).slice(0, this.maxTerms);
  }

  /** Every term in the text, without the configured common terms. */
  all(text: string): string[] {
    const spans = [...text.matchAll(CODE_SPAN)].map((m) => m[1]!.trim()).filter((t) => IDENTIFIER.test(t));
    // A word inside a code span is already covered by the more specific span.
    const pascal = [...text.matchAll(PASCAL_CASE)].map((m) => m[1]!).filter((w) => !spans.some((s) => s.includes(w)));
    const terms = [...spans, ...pascal].map((t) => ATTRIBUTE.exec(t)?.[1] ?? t);
    return [...new Set(terms)].filter((t) => t.length >= 6 && !this.common.has(t.toLowerCase()));
  }
}
