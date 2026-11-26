import type { SolutionMatch } from "../../../domain/interfaces/knowledge/SolutionMatch.js";

export interface LookupResult {
  /** `suggest`: a confident match exists, so no model is needed. `model`: start a small model session. */
  decision: "suggest" | "model";
  matches: SolutionMatch[];
}
