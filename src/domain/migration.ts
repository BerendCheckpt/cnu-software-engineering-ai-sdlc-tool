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
  /**
   * The agent that does this migration instead of a plan, such as `cnu:shiva`. Only the retailer-plugin pair may
   * name one; its grounding is that agent, so the path needs no official docs.
   */
  agent?: string;
}

/** The one pair a migration may be delegated to an agent for: legacy retailer plugins to the new plugin repos. */
export const RETAILER_PLUGIN_PAIR = { from: "ckp-retailerplugin", to: "cnu-retailerplugin" } as const;

/** Whether `from -> to` is the retailer-plugin pair, in any case. */
export function isRetailerPluginPair(from: string, to: string): boolean {
  return from.toLowerCase() === RETAILER_PLUGIN_PAIR.from && to.toLowerCase() === RETAILER_PLUGIN_PAIR.to;
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
  /** The path is done by an agent, not planned here: the engineer runs that agent. */
  | { kind: "delegate"; agent: string; path: MigrationPath }
  | { kind: "docs-missing"; missing: string[]; approvalIds: string[] }
  | { kind: "repo-missing"; repository: string }
  | { kind: "plan"; path: MigrationPath; steps: MigrationStep[]; reportPath: string };
