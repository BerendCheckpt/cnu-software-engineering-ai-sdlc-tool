import { waitingMessage } from "../../../application/helpers/cleanup/waitingMessage.js";
import type { AnalysisResult } from "../../../application/interfaces/cleanup/AnalysisResult.js";
import type { EscalationOutcome } from "../../../application/interfaces/cleanup/EscalationOutcome.js";
import type { CheckOutcome } from "../../../application/types/cleanup/CheckOutcome.js";
import type { CiOutcome } from "../../../application/types/cleanup/CiOutcome.js";
import type { NextStep } from "../../../application/types/cleanup/NextStep.js";
import type { Approval } from "../../../domain/classes/approval/Approval.js";
import type { CleanupBatch } from "../../../domain/classes/cleanup/CleanupBatch.js";
import type { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";
import { TextRenderer } from "./TextRenderer.js";

/** Compact text for the clean-up commands. Every line tells the reader what to do next. */
export class CleanupRenderer {
  constructor(private readonly text = new TextRenderer()) {}

  analysis(r: AnalysisResult): string {
    return [
      `Clean-up ${r.run.id}: ${r.batches.length} batches, ${r.run.baseline.findings.length} findings, severity level ` +
        `${r.run.level}${r.run.leftForLater.length ? ` (${r.run.leftForLater.length} below it left for later)` : ""}.`,
      ...r.run.baseline.gates.map((g) => `  ${g.kind}: ${g.skipped ? "skipped" : g.passed ? "passed" : "failed"}`),
      ...(r.run.baseline.limitations ?? []).map((l) => `  not covered: ${l}`),
      `Branch: ${r.run.branch}. Plan: ${r.planPath}`,
      `Next: aisdlc cleanup next ${r.run.id}`,
    ].join("\n");
  }

  next(step: NextStep): string {
    switch (step.kind) {
      case "finished":
        return `All batches are handled. Next: aisdlc cleanup finish ${step.run.id}`;
      case "waiting":
        return waitingMessage(step.run.id, step.batch);
      case "formatted":
        return [`Batch ${step.batch.number}: ran ${step.applied.length ? step.applied.join(", ") : "no formatter (none applies)"}.`,
          `Next: aisdlc cleanup check ${step.run.id}`].join("\n");
      case "work":
        return [
          `Batch ${step.batch.number} (${step.batch.category}), ${step.batch.findings.length} findings. ` +
            `Edit only in ${step.run.workspace}. Keep behaviour the same.`,
          ...step.findings.map(({ finding: f, code }) => f.source === "ci"
            ? `\n## CI check ${f.rule} failed. End of its log:\n${f.message}`
            : `\n## ${f.file}${f.line ? `:${f.line}` : ""} [${f.rule}] ${f.message}${code ? `\n${code}` : ""}`),
          `\nWhen done: aisdlc cleanup check ${step.run.id}`,
        ].join("\n");
    }
  }

  /** With `next`, the batch that was started after this one is printed in place of the hint to run `next`. */
  check(outcome: CheckOutcome, runId: string, next?: NextStep): string {
    const then = next ? `\n${this.next(next)}` : `Next: aisdlc cleanup next ${runId}`;
    switch (outcome.kind) {
      case "committed":
        return [`Batch ${outcome.batch.number} committed (${outcome.fixed} fixed).`,
          ...(outcome.batch.gates.length
            ? [`Flagged for the PR reviewer: ${outcome.batch.gates.map((g) => `${g.gate}: ${g.files.join(", ")}`).join("; ")}`]
            : []),
          then].join("\n");
      case "nothing-changed":
        return `Batch ${outcome.batch.number} has no changes. Fix its findings, or: aisdlc cleanup skip ${runId} --reason "<why>"`;
      case "regression":
        return [`Batch ${outcome.batch.number} is not committed:`, ...outcome.problems.map((p) => `  - ${p}`),
          ...(outcome.open.length ? ["Findings of the batch still open:", ...this.text.findings(outcome.open)] : []),
          ...this.triedBefore(outcome.history),
          `Try ${outcome.tries} of ${outcome.maxTries}. Fix every one and run: aisdlc cleanup check ${runId}` +
            (outcome.tries === outcome.maxTries - 1 ? ". If the next try fails, the engineer decides." : "")].join("\n");
      case "waiting":
        return [`Batch ${outcome.batch.number} is not committed after ${outcome.tries} tries. Its change is kept in the workspace.`,
          ...outcome.problems.map((p) => `  - ${p}`),
          ...(outcome.open.length ? ["Findings of the batch still open:", ...this.text.findings(outcome.open)] : []),
          ...(outcome.diagnosis.length ? ["Diagnosis for the engineer:", ...outcome.diagnosis.map((d) => `  - ${d}`)] : []),
          `STOP. ${waitingMessage(runId, outcome.batch)}`].join("\n");
    }
  }

  ci(outcome: CiOutcome): string {
    const { run } = outcome;
    switch (outcome.kind) {
      case "passing":
        return `CI is green on ${run.pullRequest}. The clean-up is done.`;
      case "pending":
        return `CI is still running on ${run.pullRequest}. Wait until it has finished, then: aisdlc cleanup ci ${run.id}`;
      case "none":
        return `No CI checks are reported on ${run.pullRequest}. The clean-up is done.`;
      case "unsupported":
        return `${outcome.reason}.`;
      case "escalated":
        return `CI still fails on ${run.pullRequest}, but batch ${outcome.batch.number} (ci) was ${outcome.batch.status}: ` +
          "the engineer handles it in the pull request.";
      case "waiting":
        return [`CI failed on ${run.pullRequest} on the last try (${outcome.tries}). The CI batch is not reopened.`,
          ...(outcome.diagnosis.length ? ["Diagnosis for the engineer:", ...outcome.diagnosis.map((d) => `  - ${d}`)] : []),
          `STOP. ${waitingMessage(run.id, outcome.batch)}`].join("\n");
      case "fixing":
        return [`CI failed on ${run.pullRequest}: try ${outcome.tries} of ${outcome.maxTries}.`,
          ...this.triedBefore(outcome.history),
          this.next(outcome.step),
          `Once committed, push it to the pull request with: aisdlc cleanup finish ${run.id}`].join("\n");
    }
  }

  /** Earlier failed tries of the batch: the next try must not repeat them. */
  private triedBefore(history: string[]): string[] {
    return history.length
      ? ["Tried before (do not repeat these; change the approach):", ...history.map((h) => `  - ${h}`)]
      : [];
  }

  escalation(outcome: EscalationOutcome, runId: string, next: NextStep): string {
    return [
      `Batch ${outcome.batch.number} escalated: ` + (outcome.committed
        ? "its partial fix is committed."
        : `its change was reset (${outcome.problems.join("; ")}).`),
      ...(outcome.issues.length ? [`Issues for the findings left:`, ...outcome.issues.map((i) => `  - ${i}`)] : []),
      `The PR lists them; aisdlc cleanup finish ${runId} opens it once every batch is handled.`,
      this.next(next),
    ].join("\n");
  }

  status(run: CleanupRun, batches: CleanupBatch[]): string {
    return [
      `Clean-up ${run.id} of ${run.repository}: ${run.state}, branch ${run.branch}` +
        (run.pullRequest?.startsWith("https://") ? `, ${run.pullRequest}` : "") + (run.ci ? `, CI ${run.ci}` : ""),
      ...batches.map((b) => `  ${b.number} ${b.category}: ${b.status}${b.gates.length ? ` [${b.gates.map((g) => g.gate).join(", ")}]` : ""}` +
        `${b.note ? ` - ${b.note}` : ""}`),
    ].join("\n");
  }

  approval(a: Approval): string {
    return this.text.approval(a);
  }
}
