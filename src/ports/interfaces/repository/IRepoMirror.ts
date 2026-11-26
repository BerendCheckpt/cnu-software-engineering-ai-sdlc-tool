import type { CodeLocation } from "../../../domain/interfaces/migration/CodeLocation.js";
import type { RepositoryEntry } from "../../../domain/interfaces/repository/RepositoryEntry.js";

/** Read-only local copies of repositories. */
export interface IRepoMirror {
  exists(name: string): boolean;
  clone(name: string, url: URL): Promise<void>;
  /** With `minTermsPerFile`, only files that contain that many different terms count. */
  search(name: string, terms: string[], limit: number, minTermsPerFile?: number): Promise<CodeLocation[]>;
  /** Whether the repository shows any of the markers: a file glob such as `*.razor`, or a word in the code. */
  uses(name: string, markers: string[]): Promise<boolean>;
  read(name: string, relativePath: string, startLine: number, endLine: number): Promise<string>;
  /** A writable copy of a mirror for evaluation, inside the work folder. */
  checkout(name: string, destination: string): Promise<void>;
  /** Applies a unified diff to a checked-out copy. */
  applyPatch(destination: string, diff: string): Promise<void>;
  /** The repository the mirror was cloned from (its `origin`), or undefined when it has none. */
  remoteUrl(name: string): Promise<string | undefined>;
  /** The root of the git repository a folder is in, or undefined when it is not in one. */
  topLevel(folder: string): Promise<string | undefined>;
  /** The mirror or linked folder at this path, if there is one. */
  nameAt(folder: string): RepositoryEntry | undefined;
  /** Every mirror and linked folder. */
  list(): RepositoryEntry[];
  /** For a linked folder: its checked-out branch and how many files are not committed. */
  workingState(name: string): Promise<{ branch: string; uncommitted: number }>;
}
