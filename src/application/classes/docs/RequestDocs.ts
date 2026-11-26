import type { IDocStore } from "../../../ports/interfaces/docs/IDocStore.js";
import type { ISourceCatalog } from "../../../ports/interfaces/docs/ISourceCatalog.js";
import type { DocRequestResult } from "../../types/docs/DocRequestResult.js";
import type { RequestApproval } from "../approval/RequestApproval.js";

/** Asks permission to download a page from the manifest, unless it is already here. */
export class RequestDocs {
  constructor(
    private readonly catalog: ISourceCatalog,
    private readonly docs: IDocStore,
    private readonly requestApproval: RequestApproval,
  ) {}

  execute(sourceId: string, reason: string): DocRequestResult {
    if (this.docs.hasSource(sourceId)) return { kind: "present" };
    if (!this.catalog.find(sourceId)) return { kind: "unknown" };
    return { kind: "requested", approval: this.requestApproval.execute("download", sourceId, reason) };
  }
}
