/** A CI check of a pull request that failed, with the tail of its failed log. */
export interface FailedCheck {
  name: string;
  log: string;
}
