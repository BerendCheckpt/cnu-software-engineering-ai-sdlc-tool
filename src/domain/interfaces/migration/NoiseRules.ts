/** What a migration plan leaves out, from `config/noise.yaml`. Everything is compared case-insensitively. */
export interface NoiseRules {
  /** Words every project of a stack contains: never searched as code. */
  commonTerms: string[];
  /** Navigation and policy sections, never stored as doc sections. */
  boilerplateHeadings: string[];
  /** Per doc area (a `##` heading), what shows a repository uses it: a file glob such as `*.razor`, or a word. */
  areas: Record<string, string[]>;
}
