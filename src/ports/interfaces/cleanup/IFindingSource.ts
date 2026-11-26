import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";

/** Reports open problems in a workspace: one class per tool. */
export interface IFindingSource {
  readonly name: string;
  /** Throws when it cannot report; returning fewer findings than exist would make them look fixed. */
  collect(workspace: string): Promise<Finding[]>;
  /** What the last `collect` could not look at, the same way every time, for example for lack of permission. */
  limitations?(): string[];
}
