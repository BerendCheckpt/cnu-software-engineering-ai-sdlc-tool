import type { Gate } from "../../types/cleanup/Gate.js";

export interface GateHit {
  gate: Gate;
  files: string[];
}
