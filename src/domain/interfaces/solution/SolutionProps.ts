import type { SolutionState } from "../../types/solution/SolutionState.js";

export interface SolutionProps {
  id: string;
  prompt: string;
  summary: string;
  diff: string;
  state: SolutionState;
  createdAt: string;
}
