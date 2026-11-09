import { Approval, type ApprovalKind } from "../domain/approval.js";
import { DomainError } from "../domain/errors.js";
import type { IApprovalStore } from "../ports/stores.js";

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

/**
 * Only a human decides. This use case is wired into the CLI and deliberately not into the MCP server,
 * so no model can reach it.
 */
export class DecideApproval {
  constructor(private readonly store: IApprovalStore) {}

  /** Approving something already approved but not carried out is a no-op, so the action can be retried. */
  approve(id: string, decidedBy: string): Approval {
    const approval = this.require(id);
    if (approval.status === "approved") return approval;
    approval.approve(decidedBy);
    this.store.save(approval);
    return approval;
  }

  deny(id: string, decidedBy: string): Approval {
    const approval = this.require(id);
    approval.deny(decidedBy);
    this.store.save(approval);
    return approval;
  }

  private require(id: string): Approval {
    const approval = this.store.get(id);
    if (!approval) throw new DomainError(`No approval ${id}.`);
    return approval;
  }
}
