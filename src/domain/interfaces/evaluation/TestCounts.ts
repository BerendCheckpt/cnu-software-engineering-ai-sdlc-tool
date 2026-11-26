/** What a test gate counted. `failing` is complete, unlike the digest, so runs can be compared. */
export interface TestCounts {
  total: number;
  failed: number;
  failing: string[];
}
