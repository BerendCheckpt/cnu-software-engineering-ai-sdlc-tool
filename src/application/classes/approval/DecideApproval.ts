import { Approval } from "../../../domain/classes/approval/Approval.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { IApprovalStore } from "../../../ports/interfaces/approval/IApprovalStore.js";

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
