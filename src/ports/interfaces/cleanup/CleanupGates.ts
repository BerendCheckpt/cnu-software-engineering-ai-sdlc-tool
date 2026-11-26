import type { IEvaluator } from "../evaluation/IEvaluator.js";
import type { IFindingSource } from "./IFindingSource.js";

/** The gates and finding sources for one clean-up run, which has its own SonarQube project. */
export interface CleanupGates {
  evaluators: IEvaluator[];
  findingSources: IFindingSource[];
  /** Where a human sees the open issues of this run's SonarQube project, when SonarQube is configured. */
  sonarProjectUrl?: string;
  /** The SonarQube project's key, when SonarQube is configured. */
  sonarProject?: string;
  /** Removes what the run created on outside servers; returns a note when a human has to finish that. */
  release(): Promise<string | undefined>;
}
