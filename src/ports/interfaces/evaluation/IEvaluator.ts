import type { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { EvaluationKind } from "../../../domain/types/evaluation/EvaluationKind.js";

export interface IEvaluator {
  readonly kind: EvaluationKind;
  evaluate(workspace: string): Promise<EvaluationResult>;
}
