import { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";

export function commitMessage(batch: CleanupBatch, fixed: number): string {
  if (batch.category === "format") return "Clean-up: apply the repository's formatters";
  if (batch.category === "ci") return `Clean-up: fix the failing CI checks\n\nChecks: ${batch.findings.map((f) => f.rule).join(", ")}`;
  const rules = [...new Set(batch.findings.map((f) => f.rule))].slice(0, 5).join(", ");
  return `Clean-up batch ${batch.number} (${batch.category}): ${fixed} ${fixed === 1 ? "finding" : "findings"} fixed\n\nRules: ${rules}`;
}
