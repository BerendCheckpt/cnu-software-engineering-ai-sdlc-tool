import type { Approval } from "../../../domain/classes/approval/Approval.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { IApprovalStore } from "../../../ports/interfaces/approval/IApprovalStore.js";

/** The stored approval, or a DomainError when there is none with this id. */
export function requireApproval(store: IApprovalStore, id: string): Approval {
  const approval = store.get(id);
  if (!approval) throw new DomainError(`No approval ${id}.`);
  return approval;
}
