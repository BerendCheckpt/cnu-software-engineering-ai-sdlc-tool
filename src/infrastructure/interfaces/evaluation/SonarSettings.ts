export interface SonarSettings {
  hostUrl?: string;
  /** Read from the environment by the composition root. Never logged, never put in a digest or report. */
  token?: string;
}
