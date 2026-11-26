import type { BatchCategory } from "../../types/cleanup/BatchCategory.js";
import type { BatchStatus } from "../../types/cleanup/BatchStatus.js";
import type { Finding } from "./Finding.js";
import type { GateHit } from "./GateHit.js";

export interface BatchProps {
  runId: string;
  number: number;
  category: BatchCategory;
  findings: Finding[];
  status: BatchStatus;
  /** HEAD when the batch started; its diff is everything since, so a commit by the model cannot hide a change. */
  baseSha?: string;
  attempts: number;
  /** What the committed diff touched that the PR's reviewer should look at closely. */
  gates: GateHit[];
  commitSha?: string;
  note?: string;
}
