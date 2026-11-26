/**
 * Passing tests are necessary, not sufficient: tests only check what someone thought to test. Real sample inputs
 * show behaviour nobody wrote a test for. Exported so the crystallized skills in `skills/migrations/` use the same text.
 */
export const SAMPLE_RULE = [
  "Passing the same tests is necessary, not sufficient. Where the repository has sample inputs (test data, recorded",
  "requests, fixture files), run them through the code before and after the migration: the output must match. A sample",
  "whose output changed goes back to the engineer, even when every test passes. Without samples, say so in the summary.",
];
