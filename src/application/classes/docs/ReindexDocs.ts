import { MarkdownChunker } from "../../../domain/classes/docs/MarkdownChunker.js";
import type { IDocArchive } from "../../../ports/interfaces/docs/IDocArchive.js";
import type { IDocStore } from "../../../ports/interfaces/docs/IDocStore.js";
import type { ISourceCatalog } from "../../../ports/interfaces/docs/ISourceCatalog.js";
import type { ReindexResult } from "../../interfaces/docs/ReindexResult.js";

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
