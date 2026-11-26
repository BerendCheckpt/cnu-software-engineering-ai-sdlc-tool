export interface ContainerOptions {
  /** `none` for builds, tests and local scans; `bridge` only for restoring packages and reaching SonarQube. */
  network: "none" | "bridge";
  /**
   * Names of host environment variables handed to the container, for example `SONAR_TOKEN`. Only the name goes on
   * the command line; Docker reads the value from its own environment, so a secret never shows up in `ps`.
   */
  passEnvironment?: string[];
  /** Lets the container reach a server on this machine as `host.docker.internal`, also on Linux. */
  reachHost?: boolean;
}
