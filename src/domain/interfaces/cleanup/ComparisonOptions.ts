export interface ComparisonOptions {
  /** True when the diff was classified as a tests change, flagged for the reviewer, so fewer tests is not a problem. */
  fewerTestsApproved: boolean;
}
