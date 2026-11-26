import type { ApprovalKind } from "../../types/approval/ApprovalKind.js";
import type { ApprovalStatus } from "../../types/approval/ApprovalStatus.js";

export interface ApprovalProps {
  id: string;
  kind: ApprovalKind;
  target: string;
  reason: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
}
