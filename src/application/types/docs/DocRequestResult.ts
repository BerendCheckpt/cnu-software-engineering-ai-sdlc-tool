import type { Approval } from "../../../domain/classes/approval/Approval.js";

export type DocRequestResult =
  | { kind: "present" }
  | { kind: "requested"; approval: Approval }
  /** Not in the manifest: there is no known official page, so a human has to decide. */
  | { kind: "unknown" };
