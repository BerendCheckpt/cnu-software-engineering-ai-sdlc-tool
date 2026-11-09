import type { ISkillWriter, SkillContent } from "../../application/crystallize.js";

/** A fixed template for crystallized migration skills, so every skill reads the same and costs no model tokens. */
export class MarkdownSkillWriter implements ISkillWriter {
  render(c: SkillContent): string {
    const { from, to } = c.path;
    const gates = c.evaluations.map((e) => `| ${e.kind} | ${e.isSkipped ? "skipped" : e.passed ? "passed" : "failed"} | ${cell(e.digest)} |`);
    const applied = c.applications.map((a) => `- ${a.repository}@${a.commit.slice(0, 8)}${a.pullRequestUrl ? ` (${a.pullRequestUrl})` : ""}`);
    return [
      "---",
      `name: migrate-${from}-to-${to}`,
      `description: Migrate a repository from ${from} to ${to} with steps that were done, evaluated and accepted before. ` +
        `Use when an engineer asks to upgrade or migrate from ${from} to ${to}.`,
      "---",
      "",
      `# Migrate ${from} to ${to}`,
      "",
      `Crystallized from solution \`${c.solution.id}\`: "${c.solution.summary}". A human accepted it after every gate below`,
      "passed. Follow the steps in order, and change only what a step names.",
      "",
      ...(c.path.tool ? ["## Official tool", "", c.path.tool, ""] : []),
      "## Steps",
      "",
      c.steps.trim(),
      "",
      "## Official documentation",
      "",
      "Read the part of these pages a step points to. If a page is not in the local docs, ask the engineer to approve",
      "its download (`aisdlc docs request <id>`); never migrate without it.",
      "",
      ...c.docs.map((d) => `- \`${d.id}\` (${d.framework} ${d.version}): ${d.url}`),
      "",
      "## Done when",
      "",
      "Every gate that passed before the migration passes after it, with the same tests: run `aisdlc eval` on the",
      "migrated solution. These were the results when this skill was made:",
      "",
      "| Gate | Result | Details |",
      "|---|---|---|",
      ...gates,
      "",
      ...(applied.length ? ["## Applied at", "", ...applied, ""] : []),
      "## Rules",
      "",
      "- A step that does not apply to this repository is skipped, and the summary says why.",
      "- Anything this skill does not cover goes back to the engineer: run `aisdlc migrate` for a grounded plan instead.",
      "",
    ].join("\n");
  }
}

function cell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}
