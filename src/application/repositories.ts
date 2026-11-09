import type { Approval } from "../domain/approval.js";
import { DomainError } from "../domain/errors.js";
import type { CodeLocation } from "../domain/migration.js";
import { defaultRepositoryName, requireRepositoryName, type RepositoryEntry } from "../domain/repository.js";
import { TextNormalizer } from "../domain/textNormalizer.js";
import { UrlPolicy } from "../domain/urlPolicy.js";
import type { IRepoMirror, ISourceCatalog } from "../ports/services.js";
import type { IApprovalStore, ILinkedRepositoryStore } from "../ports/stores.js";
import type { RequestApproval } from "./approvals.js";

/** The mirror name is the last path segment of the URL, without `.git`. */
export function mirrorName(url: URL): string {
  const name = url.pathname.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
  if (!name) throw new DomainError(`Cannot name a mirror for ${url.href}.`);
  return name;
}

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

/** Clones once, shallow, after a human approved it. */
export class MirrorRepository {
  constructor(
    private readonly catalog: ISourceCatalog,
    private readonly approvals: IApprovalStore,
    private readonly mirror: IRepoMirror,
  ) {}

  async execute(approvalId: string): Promise<string> {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new DomainError(`No approval ${approvalId}.`);
    approval.ensureApprovedFor("clone");
    const url = new UrlPolicy(this.catalog.repositoryHosts()).check(approval.target);
    const name = mirrorName(url);

    await this.mirror.clone(name, url);
    approval.consume("clone");
    this.approvals.save(approval);
    return name;
  }
}

/**
 * Registers a folder the engineer already pulled, so it is used where a mirror would be. Nothing is downloaded, so
 * no approval is needed; aisdlc only reads the folder and makes its changes in copies.
 */
export class LinkRepository {
  constructor(private readonly store: ILinkedRepositoryStore, private readonly mirror: IRepoMirror) {}

  /** `created` is false when the folder was already known, as a link or as a mirror. */
  async execute(folder: string, name?: string): Promise<{ entry: RepositoryEntry; created: boolean }> {
    const root = await this.mirror.topLevel(folder);
    if (!root) throw new DomainError(`${folder} is not inside a git repository.`);
    const known = this.mirror.nameAt(root);
    if (known) return { entry: known, created: false };

    const chosen = requireRepositoryName(name ?? defaultRepositoryName(root));
    const taken = this.mirror.list().find((e) => e.name.toLowerCase() === chosen.toLowerCase());
    if (taken) {
      throw new DomainError(`The name ${chosen} is already used by ${taken.kind === "mirror" ? "a mirror" : taken.path}. ` +
        "Link the folder under another name with --name.");
    }
    this.store.save({ name: chosen, path: root, linkedAt: new Date().toISOString() });
    return { entry: { name: chosen, kind: "linked", path: root }, created: true };
  }

  /** Forgets the link; the folder itself is never touched. */
  unlink(name: string): void {
    if (!this.store.remove(name)) throw new DomainError(`No linked folder named ${name}.`);
  }

  list(): RepositoryEntry[] {
    return this.mirror.list();
  }

  /** One line when a linked folder has changes that its copies will not contain; undefined otherwise. */
  async uncommittedNote(name: string): Promise<string | undefined> {
    if (this.mirror.list().find((e) => e.name.toLowerCase() === name.toLowerCase())?.kind !== "linked") return undefined;
    const { branch, uncommitted } = await this.mirror.workingState(name);
    return uncommitted
      ? `${uncommitted} ${uncommitted === 1 ? "file is" : "files are"} not committed in ${name}: aisdlc works from the last commit of ${branch}.`
      : undefined;
  }
}

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
