import { TextNormalizer } from "../../../domain/classes/knowledge/TextNormalizer.js";
import type { DocChunk } from "../../../domain/interfaces/docs/DocChunk.js";
import type { IDocStore } from "../../../ports/interfaces/docs/IDocStore.js";

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
