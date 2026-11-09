import type { Approval } from "../domain/approval.js";
import type { DocChunk } from "../domain/docs.js";
import { DomainError } from "../domain/errors.js";
import { MarkdownChunker } from "../domain/markdownChunker.js";
import { TextNormalizer } from "../domain/textNormalizer.js";
import { UrlPolicy } from "../domain/urlPolicy.js";
import type { IDocArchive, IDocFetcher, ISourceCatalog } from "../ports/services.js";
import type { IApprovalStore, IDocStore } from "../ports/stores.js";
import type { RequestApproval } from "./approvals.js";

export type DocRequestResult =
  | { kind: "present" }
  | { kind: "requested"; approval: Approval }
  /** Not in the manifest: there is no known official page, so a human has to decide. */
  | { kind: "unknown" };

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

export interface ReindexResult {
  reindexed: { id: string; chunks: number }[];
  /** Indexed, but its archived page is gone: download it again to change its sections. */
  notArchived: string[];
  failed: { id: string; error: string }[];
}

/**
 * Splits every downloaded page into sections again from its archived copy, after the chunking rules changed
 * (`config/noise.yaml`). Nothing is downloaded, so no approval is needed. One page that fails does not stop the rest.
 */
export class ReindexDocs {
  constructor(
    private readonly catalog: ISourceCatalog,
    private readonly archive: IDocArchive,
    private readonly docs: IDocStore,
    private readonly chunker = new MarkdownChunker(),
  ) {}

  execute(): ReindexResult {
    const result: ReindexResult = { reindexed: [], notArchived: [], failed: [] };
    for (const source of this.catalog.all().filter((s) => this.docs.hasSource(s.id))) {
      try {
        const page = this.archive.read(source);
        if (!page) {
          result.notArchived.push(source.id);
          continue;
        }
        const chunks = this.chunker.chunk(source, page.markdown);
        this.docs.replaceChunks(source, chunks, page.fetchedAt);
        result.reindexed.push({ id: source.id, chunks: chunks.length });
      } catch (error) {
        result.failed.push({ id: source.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  }
}

const MAX_RESULTS = 5;

/** Bounded documentation search: at most 5 sections of at most 60 lines. */
export class SearchDocs {
  constructor(
    private readonly docs: IDocStore,
    private readonly normalizer = new TextNormalizer(),
  ) {}

  execute(query: string, framework?: string, version?: string): DocChunk[] {
    return this.docs.search(this.normalizer.terms(query), MAX_RESULTS, framework, version);
  }
}
