import type { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { Solution } from "../../../domain/classes/solution/Solution.js";
import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";

/** Renders the combined evaluation report for a pull request. */
export interface IReportWriter {
  /** `openIssues` are the SonarQube issues still open at the last check, blocking or only reported. */
  render(solution: Solution, evaluations: EvaluationResult[], summary?: string, openIssues?: Finding[]): string;
}
