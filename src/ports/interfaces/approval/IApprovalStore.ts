import type { Approval } from "../../../domain/classes/approval/Approval.js";

export interface IApprovalStore {
  save(approval: Approval): void;
  get(id: string): Approval | undefined;
  pending(): Approval[];
  /** Pending, or approved but not yet carried out (for example after a failed download). */
  open(): Approval[];
}
