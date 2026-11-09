/** A migration path we know how to ground in official documentation. */
export interface MigrationPath {
  from: string;
  to: string;
  /** Doc source ids that document the source side. All must be downloaded. */
  sourceDocs: string[];
  /** Doc source ids that document the target side, including the official migration guide. */
  targetDocs: string[];
  /** An official tool that does part of the work, such as `ng update`. */
  tool?: string;
}

/** What a migration plan leaves out, from `config/noise.yaml`. Everything is compared case-insensitively. */
export interface NoiseRules {
  /** Words every project of a stack contains: never searched as code. */
  commonTerms: string[];
  /** Navigation and policy sections, never stored as doc sections. */
  boilerplateHeadings: string[];
  /** Per doc area (a `##` heading), what shows a repository uses it: a file glob such as `*.razor`, or a word. */
  areas: Record<string, string[]>;
}

export const NO_NOISE_RULES: NoiseRules = { commonTerms: [], boilerplateHeadings: [], areas: {} };

/** A migration that has been done, evaluated and accepted, and is now a reusable skill. */
export interface MigrationSkill {
  from: string;
  to: string;
  skillPath: string;
}

export interface CodeLocation {
  path: string;
  line: number;
  text: string;
}

export interface MigrationStep {
  heading: string;
  docUrl: string;
  locations: CodeLocation[];
}

/** What planning a migration led to. Anything other than `plan` stops and goes back to a human. */
export type MigrationOutcome =
  | { kind: "skill"; skill: MigrationSkill }
  | { kind: "escalate"; reason: string }
  | { kind: "docs-missing"; missing: string[]; approvalIds: string[] }
  | { kind: "repo-missing"; repository: string }
  | { kind: "plan"; path: MigrationPath; steps: MigrationStep[]; reportPath: string };
