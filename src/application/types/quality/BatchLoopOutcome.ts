/** A clean-up batch's check: `engineer` means the last try failed and the engineer decides what happens next. */
export type BatchLoopOutcome =
  | { kind: "clean" }
  | { kind: "fix-required"; tries: number; maxTries: number }
  | { kind: "engineer"; tries: number; maxTries: number };
