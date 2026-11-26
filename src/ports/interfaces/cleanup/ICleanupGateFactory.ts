import type { CleanupGates } from "./CleanupGates.js";

export interface ICleanupGateFactory {
  /** `purpose` names the SonarQube project, `aisdlc-<purpose>-<id>`: a clean-up run or a solution. */
  forRun(id: string, purpose?: "cleanup" | "solution"): CleanupGates;
}
