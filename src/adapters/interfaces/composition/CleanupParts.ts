import type { ICleanupGateFactory } from "../../../ports/interfaces/cleanup/ICleanupGateFactory.js";
import type { IDependencyRestorer } from "../../../ports/interfaces/cleanup/IDependencyRestorer.js";
import type { IFormatter } from "../../../ports/interfaces/cleanup/IFormatter.js";
import type { ICiChecks } from "../../../ports/interfaces/git/ICiChecks.js";
import type { IPullRequestPublisher } from "../../../ports/interfaces/git/IPullRequestPublisher.js";
import type { ISandbox } from "../../../ports/interfaces/process/ISandbox.js";

export interface CleanupParts {
  sandbox: ISandbox;
  restorer: IDependencyRestorer;
  gates: ICleanupGateFactory;
  formatters: IFormatter[];
  publisher?: IPullRequestPublisher;
  /** Replaces `gh pr checks`; tests use this to stay off GitHub. */
  ci?: ICiChecks;
}
