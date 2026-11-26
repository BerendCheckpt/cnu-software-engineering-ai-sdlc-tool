import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { defaultRepositoryName } from "../../../domain/helpers/repository/defaultRepositoryName.js";
import { requireRepositoryName } from "../../../domain/helpers/repository/requireRepositoryName.js";
import type { RepositoryEntry } from "../../../domain/interfaces/repository/RepositoryEntry.js";
import type { ILinkedRepositoryStore } from "../../../ports/interfaces/repository/ILinkedRepositoryStore.js";
import type { IRepoMirror } from "../../../ports/interfaces/repository/IRepoMirror.js";

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
