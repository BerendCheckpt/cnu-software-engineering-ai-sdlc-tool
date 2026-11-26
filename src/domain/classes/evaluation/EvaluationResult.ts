import type { EvaluationMetrics } from "../../interfaces/evaluation/EvaluationMetrics.js";
import type { EvaluationKind } from "../../types/evaluation/EvaluationKind.js";

const MAX_DIGEST_LENGTH = 1024;

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
