import type { AnalysisResult, CheckOutcome, NextStep } from "../application/cleanup.js";
import type { EvaluationOutcome } from "../application/evaluation.js";
import type { FindingWithCode } from "../application/snippets.js";
import type { Approval } from "../domain/approval.js";
import type { CleanupBatch, CleanupRun } from "../domain/cleanup.js";
import type { DocChunk } from "../domain/docs.js";
import type { EvaluationResult } from "../domain/evaluation.js";
import type { SolutionMatch } from "../domain/knowledge.js";
import type { CodeLocation, MigrationOutcome } from "../domain/migration.js";

/**
 * Compact text for every adapter. Whatever a model reads costs tokens on every following turn,
 * so each line carries one fact and nothing decorative.
 */
export class TextRenderer {
  match(m: SolutionMatch): string {
    const lines = [
      `solution ${m.solution.id} (${m.solution.state}${m.exact ? ", exact match" : `, overlap ${m.overlap.toFixed(2)}`})`,
      `  ${m.solution.summary}`,
    ];
    for (const e of m.evaluations) lines.push(`  ${this.evaluationLine(e)}`);
    for (const a of m.applications) {
      lines.push(`  applied: ${a.repository}@${a.commit.slice(0, 8)} ${a.files.join(", ")}${a.pullRequestUrl ? ` ${a.pullRequestUrl}` : ""}`);
    }
    return lines.join("\n");
  }

  matches(matches: SolutionMatch[]): string {
    return matches.length ? matches.map((m) => this.match(m)).join("\n") : "no accepted solutions found";
  }

  evaluationLine(e: EvaluationResult): string {
    return `${e.kind}: ${e.isSkipped ? "skipped" : e.passed ? "passed" : "FAILED"} - ${e.digest}`;
  }

  /** What `eval` found and the one next step, for the CLI and for a model. */
  evaluation(solutionId: string, repository: string, o: EvaluationOutcome & { reportPath: string }): string {
    const lines = [...o.results.map((r) => this.evaluationLine(r))];
    if (o.blocking.length) lines.push("Blocking SonarQube issues (fix these):", ...this.findings(o.blocking));
    if (o.reported.length) lines.push("Other SonarQube issues (fix these too; they do not block):", ...this.findings(o.reported));
    lines.push(...o.limitations.map((l) => `not covered: ${l}`), `report: ${o.reportPath}`);
    switch (o.loop.kind) {
      case "clean":
        lines.push(`Evaluated. A human accepts it with: aisdlc solution-accept ${solutionId}`);
        break;
      case "fix-required":
        lines.push(`Fix attempt ${o.loop.failures} of ${o.loop.maxFixAttempts}. Fix the issues above, save the new diff with ` +
          `revise, then evaluate again: aisdlc eval ${solutionId} --repo ${repository}` +
          (o.loop.failures === o.loop.maxFixAttempts ? ". One more failure goes to a human." : ""));
        break;
      case "escalated":
        lines.push(`Too many failed checks: a human has it now. Stop here. Escalation: ${o.loop.where}`);
        break;
      case "not-checked":
        lines.push("No gate ran, or the solution is not a draft: nothing was counted.");
        break;
    }
    return lines.join("\n");
  }

  findings(list: FindingWithCode[]): string[] {
    return list.map(({ finding: f, code }) =>
      `## ${f.severity} ${f.file}${f.line ? `:${f.line}` : ""} [${f.rule}] ${f.message}${code ? `\n${code}` : ""}`);
  }

  chunks(chunks: DocChunk[]): string {
    if (!chunks.length) return "no documentation found";
    return chunks.map((c) => `## ${c.heading} [${c.sourceId}] ${c.url}\n${c.content}`).join("\n\n");
  }

  locations(locations: CodeLocation[]): string {
    return locations.length ? locations.map((l) => `${l.path}:${l.line}: ${l.text}`).join("\n") : "no matches";
  }

  approval(a: Approval): string {
    return `approval ${a.id}: ${a.kind} ${a.target} (${a.status})${a.reason ? ` - ${a.reason}` : ""}`;
  }

  migration(outcome: MigrationOutcome): string {
    switch (outcome.kind) {
      case "skill":
        return `A crystallized migration skill exists: ${outcome.skill.skillPath}`;
      case "escalate":
        return `Escalated to a human: ${outcome.reason}`;
      case "docs-missing":
        return [`Official documentation is missing: ${outcome.missing.join(", ")}.`,
          `A human must approve: ${outcome.approvalIds.map((id) => `aisdlc approve ${id}`).join("; ")}`].join("\n");
      case "repo-missing":
        return `Repository ${outcome.repository} is not mirrored or linked. Ask the engineer for its local folder ` +
          "(aisdlc repo link <folder>) or its git URL (aisdlc repo add <url>).";
      case "plan":
        return `Plan with ${outcome.steps.length} step(s): ${outcome.reportPath}`;
    }
  }
}

/** Compact text for the clean-up commands. Every line tells the reader what to do next. */
export class CleanupRenderer {
  constructor(private readonly text = new TextRenderer()) {}

  analysis(r: AnalysisResult): string {
    return [
      `Clean-up ${r.run.id}: ${r.batches.length} batches, ${r.run.baseline.findings.length} findings.`,
      ...r.run.baseline.gates.map((g) => `  ${g.kind}: ${g.skipped ? "skipped" : g.passed ? "passed" : "failed"}`),
      ...(r.run.baseline.limitations ?? []).map((l) => `  not covered: ${l}`),
      `Plan: ${r.planPath}`,
      `A human approves the plan: aisdlc approve ${r.approval.id}`,
    ].join("\n");
  }

  next(step: NextStep): string {
    switch (step.kind) {
      case "finished":
        return `All batches are handled. Next: aisdlc cleanup finish ${step.run.id}`;
      case "waiting":
        return `Batch ${step.batch.number} waits for a human: aisdlc approve ${step.batch.approvalId} (or deny). Stop here.`;
      case "formatted":
        return [`Batch ${step.batch.number}: ran ${step.applied.length ? step.applied.join(", ") : "no formatter (none applies)"}.`,
          `Next: aisdlc cleanup check ${step.run.id}`].join("\n");
      case "work":
        return [
          `Batch ${step.batch.number} (${step.batch.category}), ${step.batch.findings.length} findings. ` +
            `Edit only in ${step.run.workspace}. Keep behaviour the same.`,
          ...step.findings.map(({ finding: f, code }) =>
            `\n## ${f.file}${f.line ? `:${f.line}` : ""} [${f.rule}] ${f.message}${code ? `\n${code}` : ""}`),
          `\nWhen done: aisdlc cleanup check ${step.run.id}`,
        ].join("\n");
    }
  }

  check(outcome: CheckOutcome, runId: string): string {
    switch (outcome.kind) {
      case "committed":
        return `Batch ${outcome.batch.number} committed (${outcome.fixed} fixed). Next: aisdlc cleanup next ${runId}`;
      case "nothing-changed":
        return `Batch ${outcome.batch.number} has no changes. Fix its findings, or: aisdlc cleanup skip ${runId} --reason "<why>"`;
      case "regression":
        return [`Batch ${outcome.batch.number} is not committed:`, ...outcome.problems.map((p) => `  - ${p}`),
          ...(outcome.open.length ? ["Blocking SonarQube issues still open:", ...this.text.findings(outcome.open)] : []),
          `Fix attempt ${outcome.failures} of ${outcome.maxFixAttempts}. Fix it and run: aisdlc cleanup check ${runId}` +
            (outcome.failures === outcome.maxFixAttempts ? ". One more failure goes to a human." : "")].join("\n");
      case "escalated":
        return [`Batch ${outcome.batch.number} failed its checks too often: its change was reset and a human has it now.`,
          `Escalation: ${outcome.where}`, `Next: aisdlc cleanup next ${runId}`].join("\n");
      case "awaiting-approval":
        return [`Batch ${outcome.batch.number} needs a human before it is committed:`,
          ...outcome.gates.map((g) => `  - ${g.gate}: ${g.files.join(", ")}`),
          `A human decides: aisdlc approve ${outcome.approval.id} (or deny). Stop here.`].join("\n");
    }
  }

  status(run: CleanupRun, batches: CleanupBatch[]): string {
    return [
      `Clean-up ${run.id} of ${run.repository}: ${run.state}, branch ${run.branch}` +
        (run.pullRequest?.startsWith("https://") ? `, ${run.pullRequest}` : ""),
      ...batches.map((b) => `  ${b.number} ${b.category}: ${b.status}${b.gates.length ? ` [${b.gates.map((g) => g.gate).join(", ")}]` : ""}` +
        `${b.note ? ` - ${b.note}` : ""}`),
    ].join("\n");
  }

  approval(a: Approval): string {
    return this.text.approval(a);
  }
}
