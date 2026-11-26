import { UrlPolicy } from "../../../domain/classes/security/UrlPolicy.js";
import type { IApprovalStore } from "../../../ports/interfaces/approval/IApprovalStore.js";
import type { ISourceCatalog } from "../../../ports/interfaces/docs/ISourceCatalog.js";
import type { IRepoMirror } from "../../../ports/interfaces/repository/IRepoMirror.js";
import { requireApproval } from "../../helpers/approval/requireApproval.js";
import { mirrorName } from "../../helpers/repository/mirrorName.js";

/** Clones once, shallow, after a human approved it. */
export class MirrorRepository {
  constructor(
    private readonly catalog: ISourceCatalog,
    private readonly approvals: IApprovalStore,
    private readonly mirror: IRepoMirror,
  ) {}

  async execute(approvalId: string): Promise<string> {
    const approval = requireApproval(this.approvals, approvalId);
    approval.ensureApprovedFor("clone");
    const url = new UrlPolicy(this.catalog.repositoryHosts()).check(approval.target);
    const name = mirrorName(url);

    await this.mirror.clone(name, url);
    approval.consume("clone");
    this.approvals.save(approval);
    return name;
  }
}
