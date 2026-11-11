import { findingKey, type Finding } from "../../domain/cleanup.js";
import type { FixLoop } from "../../domain/quality.js";
import type { EscalationContext, IEscalationWriter } from "../../ports/services.js";

/** A diff longer than this is cut, so the issue stays readable; the full change is in the workspace. */
const MAX_DIFF = 20_000;

/** A fixed template, so a human can pick the task up without asking anyone. No model writes it. */
export class EscalationReportWriter implements IEscalationWriter {
  render(context: EscalationContext, loop: FixLoop, maxFixAttempts: number): { title: string; body: string } {
    const last = loop.last;
    const blocking = last?.blocking ?? [];
    const problems = last?.problems ?? [];
    const what = blocking.length
      ? `${blocking.length} SonarQube ${blocking.length === 1 ? "issue" : "issues"} still open`
      : `${problems.length} ${problems.length === 1 ? "problem" : "problems"} left`;
    const title = `aisdlc: ${what} after ${maxFixAttempts} fix attempts: ${context.task}`;
    const rules = context.sonarProjectUrl ? new URL(context.sonarProjectUrl).origin : undefined;

    const body = [
      `aisdlc stopped this task after the first check and ${maxFixAttempts} fix attempts failed. ` +
        "It needs a person: the model may not try again until a human hands it back.",
      "",
      "## Task",
      "",
      `**${context.task}**`,
      ...context.details.map((d) => `- ${d}`),
      "",
      "## Where",
      "",
      `- Repository: ${context.remoteUrl ?? context.repository} (mirror \`${context.repository}\`)`,
      ...context.location.map((l) => `- ${l}`),
      ...(context.sonarProjectUrl ? [`- SonarQube: ${context.sonarProjectUrl}`] : []),
      "",
      ...(blocking.length ? [
        "## Open blocking issues",
        "",
        "| Severity | Rule | Location | Message |",
        "|---|---|---|---|",
        ...blocking.map((f) => `| ${f.severity} | ${this.rule(f, rules)} | \`${f.file}${f.line ? `:${f.line}` : ""}\` | ${this.cell(f.message)} |`),
        "",
      ] : []),
      ...(problems.length ? ["## Other problems at the last check", "", ...problems.map((p) => `- ${p}`), ""] : []),
      ...((last?.reported.length ?? 0) > 0 ? [
        "## Also open, not blocking",
        "",
        ...last!.reported.map((f) => `- ${f.severity} ${f.rule} \`${f.file}${f.line ? `:${f.line}` : ""}\`: ${f.message}`),
        "",
      ] : []),
      "## Attempts",
      "",
      "| # | When | Blocking open | Fixed since the previous check | New since the previous check | Other problems |",
      "|---|---|---|---|---|---|",
      ...loop.attempts.map((a, i) => {
        const previous = loop.attempts[i - 1]?.blocking ?? [];
        return `| ${i + 1} | ${a.at} | ${a.blocking.length} | ${i ? this.keys(minus(previous, a.blocking)) : "-"} | ` +
          `${i ? this.keys(minus(a.blocking, previous)) : "-"} | ${this.cell(a.problems.join("; ")) || "-"} |`;
      }),
      "",
      ...(context.limitations.length ? ["## Not covered by the check", "", ...context.limitations.map((l) => `- ${l}`), ""] : []),
      "## Reproduce",
      "",
      "```",
      context.reproduce,
      "```",
      "",
      "## Last change tried",
      "",
      ...(context.diff.trim() ? [
        "<details><summary>Diff</summary>",
        "",
        "```diff",
        context.diff.length > MAX_DIFF ? `${context.diff.slice(0, MAX_DIFF)}\n… cut; the full change is in the workspace` : context.diff.trimEnd(),
        "```",
        "",
        "</details>",
      ] : ["No change was made."]),
      "",
      "## What is left for you",
      "",
      "- Fix the issues above, or decide in SonarQube that one is a false positive and say why.",
      "- Hand the task back when it is unblocked; for a solution: `aisdlc reopen <solutionId>` in your own terminal.",
      "",
      "Opened by aisdlc. Nothing was pushed.",
      "",
    ].join("\n");
    return { title, body };
  }

  renderFinding(context: EscalationContext, finding: Finding, loop: FixLoop): { title: string; body: string } {
    const at = `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
    const rules = context.sonarProjectUrl ? new URL(context.sonarProjectUrl).origin : undefined;
    const title = `aisdlc: ${finding.severity} ${finding.rule} in ${finding.file}: ${finding.message}`.slice(0, 240);
    const body = [
      `aisdlc could not fix this finding in ${loop.attempts.length} tries, and the engineer chose to open a pull ` +
        "request with an issue for each finding that was left.",
      "",
      "## Finding",
      "",
      `- Severity: ${finding.severity}`,
      `- Rule: ${this.rule(finding, rules)}`,
      `- Location: \`${at}\``,
      `- Message: ${finding.message}`,
      "",
      "## Where",
      "",
      `- Task: ${context.task}`,
      `- Repository: ${context.remoteUrl ?? context.repository} (mirror \`${context.repository}\`)`,
      ...context.location.map((l) => `- ${l}`),
      ...(context.sonarProjectUrl ? [`- SonarQube: ${context.sonarProjectUrl}`] : []),
      "",
      ...(context.limitations.length ? ["## Not covered by the check", "", ...context.limitations.map((l) => `- ${l}`), ""] : []),
      "## What is left for you",
      "",
      "- Fix the finding, or decide in SonarQube that it is a false positive and say why.",
      "",
      "Opened by aisdlc.",
      "",
    ].join("\n");
    return { title, body };
  }

  private rule(f: Finding, origin: string | undefined): string {
    return origin ? `[${f.rule}](${origin}/coding_rules?open=${encodeURIComponent(f.rule)})` : f.rule;
  }

  private keys(findings: Finding[]): string {
    return findings.length ? findings.map((f) => `${f.rule} ${f.file}`).join(", ") : "none";
  }

  /** Keeps text on one table row. */
  private cell(text: string): string {
    return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  }
}

function minus(from: Finding[], remove: Finding[]): Finding[] {
  const gone = new Set(remove.map(findingKey));
  return from.filter((f) => !gone.has(findingKey(f)));
}
