import { Approval } from "../../../domain/classes/approval/Approval.js";
import type { ApprovalKind } from "../../../domain/types/approval/ApprovalKind.js";
import type { IApprovalStore } from "../../../ports/interfaces/approval/IApprovalStore.js";

/**
 * Anyone, including a model, may ask. Asking again for something that is still open (pending, or approved but not
 * yet carried out) returns the same request instead of a duplicate.
 */
export class RequestApproval {
  constructor(private readonly store: IApprovalStore) {}

  execute(kind: ApprovalKind, target: string, reason: string): Approval {
    const existing = this.store.open().find((a) => a.kind === kind && a.target === target);
    if (existing) return existing;
    const approval = Approval.request(kind, target, reason);
    this.store.save(approval);
    return approval;
  }
}
