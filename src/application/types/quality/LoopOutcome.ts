export type LoopOutcome =
  | { kind: "clean" }
  | { kind: "fix-required"; failures: number; maxFixAttempts: number }
  | { kind: "escalated"; failures: number; where: string };
