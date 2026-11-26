import type { Finding } from "./Finding.js";
import type { GateSnapshot } from "./GateSnapshot.js";

/** Everything measured about the workspace at one moment: gate outcomes and open findings. */
export interface Snapshot {
  gates: GateSnapshot[];
  findings: Finding[];
  /** What this measurement could not cover, shown in the plan and the report. */
  limitations?: string[];
}
