/** Where builds, tests and scanners of a repository run. The clean-up refuses to run without it. */
export interface ISandbox {
  ensureAvailable(): Promise<void>;
}
