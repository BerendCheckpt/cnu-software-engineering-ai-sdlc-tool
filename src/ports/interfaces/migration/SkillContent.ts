import type { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { Solution } from "../../../domain/classes/solution/Solution.js";
import type { DocSource } from "../../../domain/interfaces/docs/DocSource.js";
import type { Application } from "../../../domain/interfaces/knowledge/Application.js";
import type { MigrationPath } from "../../../domain/interfaces/migration/MigrationPath.js";

/** Everything a crystallized migration skill is written from. */
export interface SkillContent {
  path: MigrationPath;
  solution: Solution;
  steps: string;
  docs: DocSource[];
  evaluations: EvaluationResult[];
  applications: Application[];
}
