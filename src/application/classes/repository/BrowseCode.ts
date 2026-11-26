import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { TextNormalizer } from "../../../domain/classes/knowledge/TextNormalizer.js";
import type { CodeLocation } from "../../../domain/interfaces/migration/CodeLocation.js";
import type { IRepoMirror } from "../../../ports/interfaces/repository/IRepoMirror.js";

const MAX_HITS = 5;

/** Bounded, read-only code access for a model: at most 5 hits, at most 40 lines per snippet. */
export class BrowseCode {
  constructor(
    private readonly mirror: IRepoMirror,
    private readonly normalizer = new TextNormalizer(),
  ) {}

  async search(repository: string, query: string): Promise<CodeLocation[]> {
    this.requireMirror(repository);
    // Code identifiers are searched as typed, not stemmed.
    const terms = query.split(/\s+/).filter((t) => t.length > 1 && this.normalizer.terms(t).length > 0);
    return this.mirror.search(repository, terms, MAX_HITS);
  }

  async read(repository: string, path: string, startLine: number, endLine: number): Promise<string> {
    this.requireMirror(repository);
    return this.mirror.read(repository, path, startLine, endLine);
  }

  private requireMirror(repository: string): void {
    if (!this.mirror.exists(repository)) {
      throw new DomainError(`Repository ${repository} is not mirrored or linked. Ask the engineer for its local folder ` +
        "(aisdlc repo link <folder>) or its git URL (aisdlc repo add <url>).");
    }
  }
}
