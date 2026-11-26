/** One line about a test run: how many passed, and the first five failing tests. */
export function testSummary(tests: { total: number; failed: number; failing: string[] }): string {
  const failing = tests.failing.length ? `; failing: ${tests.failing.slice(0, 5).join(", ")}` : "";
  return `${tests.total - tests.failed}/${tests.total} passed${failing}`;
}
