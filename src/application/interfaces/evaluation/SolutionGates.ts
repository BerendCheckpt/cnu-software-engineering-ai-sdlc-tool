import type { IFindingSource } from "../../../ports/interfaces/cleanup/IFindingSource.js";
import type { IEvaluator } from "../../../ports/interfaces/evaluation/IEvaluator.js";

/** The gates of one solution and the source of its SonarQube issues. */
export interface SolutionGates {
  evaluators: IEvaluator[];
  findingSources: IFindingSource[];
  sonarProjectUrl?: string;
}
