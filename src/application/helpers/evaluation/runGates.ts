import { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { IEvaluator } from "../../../ports/interfaces/evaluation/IEvaluator.js";
import { errorMessage } from "../../../shared/helpers/errors/errorMessage.js";

/** Runs every gate in parallel. One broken gate must not hide the others' results, so an error becomes a failure. */
export function runGates(evaluators: IEvaluator[], workspace: string): Promise<EvaluationResult[]> {
  return Promise.all(evaluators.map(async (evaluator) => {
    try {
      return await evaluator.evaluate(workspace);
    } catch (error) {
      return new EvaluationResult(evaluator.kind, false, `error: ${errorMessage(error)}`);
    }
  }));
}
