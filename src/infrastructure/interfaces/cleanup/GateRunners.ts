import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";

export interface GateRunners {
  /** No network: tests, builds, gitleaks. */
  offline: IProcessRunner;
  /** Network for the package registries: dependency audits. */
  online: IProcessRunner;
  /** Network and the SonarQube variables: the scanner. */
  scanner: IProcessRunner;
}
