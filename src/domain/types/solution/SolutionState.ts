/** `escalated`: the model failed its checks too often; a human took it over and only a human reopens it. */
export type SolutionState =
  "draft" | "evaluated" | "accepted" | "rejected" | "crystallized" | "deprecated" | "escalated";
