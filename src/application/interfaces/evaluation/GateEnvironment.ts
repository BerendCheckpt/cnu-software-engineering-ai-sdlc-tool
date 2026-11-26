import type { IDependencyRestorer } from "../../../ports/interfaces/cleanup/IDependencyRestorer.js";
import type { ISandbox } from "../../../ports/interfaces/process/ISandbox.js";

/** Where the gates run: the sandbox must be there, and packages are restored before any gate starts. */
export interface GateEnvironment {
  sandbox: ISandbox;
  restorer: IDependencyRestorer;
}
