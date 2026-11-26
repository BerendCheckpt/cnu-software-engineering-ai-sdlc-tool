import type { DocChunk } from "../../../domain/interfaces/docs/DocChunk.js";
import type { DocSource } from "../../../domain/interfaces/docs/DocSource.js";

export interface IDocStore {
  /** `fetchedAt` is when the page was downloaded: now, unless an archived page is chunked again. */
  replaceChunks(source: DocSource, chunks: DocChunk[], fetchedAt?: string): void;
  hasSource(sourceId: string): boolean;
  search(terms: string[], limit: number, framework?: string, version?: string): DocChunk[];
  chunksOf(sourceId: string): DocChunk[];
}
