import type { CiState } from "../../types/cleanup/CiState.js";
import type { CleanupLevel } from "../../types/cleanup/CleanupLevel.js";
import type { RunState } from "../../types/cleanup/RunState.js";
import type { Snapshot } from "./Snapshot.js";

export interface RunProps {
  id: string;
  repository: string;
  workspace: string;
  branch: string;
  baseBranch: string;
  state: RunState;
  /** The measurement before anything changed. */
  baseline: Snapshot;
  /** The measurement after the last committed batch; each check is compared with it. */
  reference: Snapshot;
  pullRequest?: string;
  createdAt: string;
  /** Which SonarQube severities this run must fix; runs from before this setting are `verbose`. */
  level?: CleanupLevel;
  /** The pull request's CI at the last `cleanup ci`; undefined until it was read. */
  ci?: { state: CiState; checkedAt: string };
}
