/** Which paths and lines count as tests, dependencies or security-sensitive code. Comes from `config/cleanup.yaml`. */
export interface GatePatterns {
  testFiles: RegExp[];
  dependencyFiles: RegExp[];
  securityFiles: RegExp[];
  securityContent: RegExp[];
}
