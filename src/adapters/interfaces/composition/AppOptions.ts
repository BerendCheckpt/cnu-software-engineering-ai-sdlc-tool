import type { IEvaluator } from "../../../ports/interfaces/evaluation/IEvaluator.js";
import type { IIssueTracker } from "../../../ports/interfaces/quality/IIssueTracker.js";
import type { CleanupParts } from "./CleanupParts.js";

export interface AppOptions {
  /** Replaces the containerized gates of `eval` and `run_evaluations`; tests use this to run without Docker. */
  evaluators?: IEvaluator[];
  /** Replaces the containers of the clean-up; tests use this to run without Docker. */
  cleanup?: CleanupParts;
  /** Replaces `gh issue create` for escalations; tests use this to stay off GitHub. */
  issueTracker?: IIssueTracker;
}
