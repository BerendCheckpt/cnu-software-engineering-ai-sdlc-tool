import type { DocSource } from "../../../domain/interfaces/docs/DocSource.js";

/** The source manifest: which pages exist, and which hosts docs and repositories may come from. */
export interface ISourceCatalog {
  docHosts(): string[];
  repositoryHosts(): string[];
  find(sourceId: string): DocSource | undefined;
  all(): DocSource[];
}
