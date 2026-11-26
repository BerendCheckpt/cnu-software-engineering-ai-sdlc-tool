import { MarkdownChunker } from "../../../domain/classes/docs/MarkdownChunker.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { UrlPolicy } from "../../../domain/classes/security/UrlPolicy.js";
import type { IApprovalStore } from "../../../ports/interfaces/approval/IApprovalStore.js";
import type { IDocArchive } from "../../../ports/interfaces/docs/IDocArchive.js";
import type { IDocFetcher } from "../../../ports/interfaces/docs/IDocFetcher.js";
import type { IDocStore } from "../../../ports/interfaces/docs/IDocStore.js";
import type { ISourceCatalog } from "../../../ports/interfaces/docs/ISourceCatalog.js";

/** Downloads a page once, after a human approved it, and indexes it. */
export class PullDocs {
  constructor(
    private readonly catalog: ISourceCatalog,
    private readonly approvals: IApprovalStore,
    private readonly fetcher: IDocFetcher,
    private readonly archive: IDocArchive,
    private readonly docs: IDocStore,
    private readonly chunker = new MarkdownChunker(),
  ) {}

  async execute(approvalId: string): Promise<{ file: string; chunks: number }> {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new DomainError(`No approval ${approvalId}.`);
    const source = this.catalog.find(approval.target);
    if (!source) throw new DomainError(`${approval.target} is not in config/sources.yaml.`);
    const url = new UrlPolicy(this.catalog.docHosts()).check(source.url);
    approval.ensureApprovedFor("download");

    // A failed download leaves the approval usable; a successful one uses it up.
    const markdown = await this.fetcher.fetchMarkdown(url);
    const file = this.archive.write(source, markdown);
    const chunks = this.chunker.chunk(source, markdown);
    this.docs.replaceChunks(source, chunks);

    approval.consume("download");
    this.approvals.save(approval);
    return { file, chunks: chunks.length };
  }
}
