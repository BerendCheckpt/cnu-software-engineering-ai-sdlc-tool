import type { Approval } from "../../../domain/classes/approval/Approval.js";
import type { IApprovalStore } from "../../../ports/interfaces/approval/IApprovalStore.js";
import { requireApproval } from "../../helpers/approval/requireApproval.js";

/**
 * Only a human decides. This use case is wired into the CLI and deliberately not into the MCP server,
 * so no model can reach it.
 */
export class DecideApproval {
  constructor(private readonly store: IApprovalStore) {}

  /** Approving something already approved but not carried out is a no-op, so the action can be retried. */
  approve(id: string, decidedBy: string): Approval {
    const approval = requireApproval(this.store, id);
    if (approval.status === "approved") return approval;
    approval.approve(decidedBy);
    this.store.save(approval);
    return approval;
  }

  deny(id: string, decidedBy: string): Approval {
    const approval = requireApproval(this.store, id);
    approval.deny(decidedBy);
    this.store.save(approval);
    return approval;
  }
}
