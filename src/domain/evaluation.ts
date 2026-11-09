export type EvaluationKind = "xunit" | "vitest" | "angular" | "sonar";

const MAX_DIGEST_LENGTH = 1024;

/** What a test gate counted. `failing` is complete, unlike the digest, so runs can be compared. */
export interface TestCounts {
  total: number;
  failed: number;
  failing: string[];
}

/** Numbers a gate measured, for comparing one run with another. */
export interface EvaluationMetrics {
  tests?: TestCounts;
  /** Line coverage in percent. */
  coverage?: number;
}

/** The outcome of one gate. The digest is short enough to put in any context; the report path holds the rest. */
export class EvaluationResult {
  readonly digest: string;

  constructor(
    readonly kind: EvaluationKind,
    readonly passed: boolean,
    digest: string,
    readonly reportPath?: string,
    readonly metrics: EvaluationMetrics = {},
  ) {
    this.digest = digest.length > MAX_DIGEST_LENGTH ? `${digest.slice(0, MAX_DIGEST_LENGTH - 1)}…` : digest;
  }

  static skipped(kind: EvaluationKind, why: string): EvaluationResult {
    return new EvaluationResult(kind, true, `skipped: ${why}`);
  }

  get isSkipped(): boolean {
    return this.digest.startsWith("skipped:");
  }
}
