import type { EvaluationOutcome } from "../../../application/interfaces/evaluation/EvaluationOutcome.js";
import type { FindingWithCode } from "../../../application/interfaces/solution/FindingWithCode.js";
import type { Approval } from "../../../domain/classes/approval/Approval.js";
import type { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { DocChunk } from "../../../domain/interfaces/docs/DocChunk.js";
import type { SolutionMatch } from "../../../domain/interfaces/knowledge/SolutionMatch.js";
import type { CodeLocation } from "../../../domain/interfaces/migration/CodeLocation.js";
import type { MigrationOutcome } from "../../../domain/types/migration/MigrationOutcome.js";
import { findingLocation } from "../../../shared/helpers/findings/findingLocation.js";
import { shortSha } from "../../../shared/helpers/text/shortSha.js";

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
      lines.push(`  applied: ${a.repository}@${shortSha(a.commit)}${a.files.join(", ")}${a.pullRequestUrl ? ` ${a.pullRequestUrl}` : ""}`);
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
      `## ${f.severity} ${findingLocation(f)} [${f.rule}] ${f.message}${code ? `\n${code}` : ""}`);
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
      case "delegate":
        return `Migration ${outcome.path.from} -> ${outcome.path.to} is done by the ${outcome.agent} agent, not planned ` +
          `here. Run ${outcome.agent} for the retailer; aisdlc writes no plan.`;
      case "docs-missing":
        return [`Official documentation is missing: ${outcome.missing.join(", ")}.`,
          `A human must approve: ${outcome.approvalIds.map((id) => `aisdlc approve ${id}`).join("; ")}`].join("\n");
      case "repo-missing":
        return `Repository ${outcome.repository} is not mirrored or linked. Ask the engineer for its local folder ` +
          "(aisdlc repo link <folder>) or its git URL (aisdlc repo add <url>).";
      case "plan":
      {
        const count = (d: string) => outcome.steps.filter((s) => s.decision === d).length;
        return `Plan with ${count("port")} step(s) to port, ${count("drop")} dropped, ` +
          `${outcome.questions.length} open question(s): ${outcome.reportPath}`;
      }
    }
  }
}
