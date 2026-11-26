export type FixVerdict =
  | { kind: "clean" }
  | { kind: "fix-required"; failures: number; maxFixAttempts: number }
  | { kind: "escalate"; failures: number };
