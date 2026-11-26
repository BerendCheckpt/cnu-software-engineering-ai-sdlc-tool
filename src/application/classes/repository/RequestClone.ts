import type { Approval } from "../../../domain/classes/approval/Approval.js";
import { UrlPolicy } from "../../../domain/classes/security/UrlPolicy.js";
import type { ISourceCatalog } from "../../../ports/interfaces/docs/ISourceCatalog.js";
import type { RequestApproval } from "../approval/RequestApproval.js";

/** Asks permission to clone a repository. The URL is checked before a human is even asked. */
export class RequestClone {
  constructor(
    private readonly catalog: ISourceCatalog,
    private readonly requestApproval: RequestApproval,
  ) {}

  execute(rawUrl: string, reason: string): Approval {
    const url = new UrlPolicy(this.catalog.repositoryHosts()).check(rawUrl);
    return this.requestApproval.execute("clone", url.href, reason);
  }
}
