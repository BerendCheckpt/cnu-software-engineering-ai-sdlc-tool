import type { MigrationPath } from "../../interfaces/migration/MigrationPath.js";
import type { MigrationSkill } from "../../interfaces/migration/MigrationSkill.js";
import type { MigrationStep } from "../../interfaces/migration/MigrationStep.js";
import type { OpenQuestion } from "../../interfaces/migration/OpenQuestion.js";

/** What planning a migration led to. Anything other than `plan` stops and goes back to a human. */
export type MigrationOutcome =
  | { kind: "skill"; skill: MigrationSkill }
  | { kind: "escalate"; reason: string }
  /** The path is done by an agent, not planned here: the engineer runs that agent. */
  | { kind: "delegate"; agent: string; path: MigrationPath }
  | { kind: "docs-missing"; missing: string[]; approvalIds: string[] }
  | { kind: "repo-missing"; repository: string }
  | { kind: "plan"; path: MigrationPath; steps: MigrationStep[]; questions: OpenQuestion[]; reportPath: string };
