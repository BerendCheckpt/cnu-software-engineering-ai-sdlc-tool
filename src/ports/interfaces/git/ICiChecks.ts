import type { CiResult } from "../../types/git/CiResult.js";

/** Reads the CI checks of a pull request. It never waits for them. */
export interface ICiChecks {
  read(workspace: string, pullRequest: string): Promise<CiResult>;
}
