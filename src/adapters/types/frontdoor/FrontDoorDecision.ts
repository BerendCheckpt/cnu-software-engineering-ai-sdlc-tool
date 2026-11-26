export type FrontDoorDecision =
  /** Answer with this reply; no model is needed. */
  | { kind: "suggestion"; reply: string; solutionIds: string[] }
  /** Start a budgeted model session with this brief as its first message. */
  | { kind: "model"; brief: string };
