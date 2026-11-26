import { readFileSync } from "node:fs";
import { FrontDoor } from "../../classes/frontdoor/FrontDoor.js";
import { TextRenderer } from "../../classes/render/TextRenderer.js";
import { positional } from "../../helpers/cli/positional.js";
import { required } from "../../helpers/cli/required.js";
import { withNote } from "../../helpers/cli/withNote.js";
import type { CliCommand } from "../../interfaces/cli/CliCommand.js";

const renderer = new TextRenderer();

/** Finding, proposing, evaluating and accepting solutions. */
export const SOLUTION_COMMANDS: CliCommand[] = [
  {
    name: "lookup",
    usage: 'lookup "<prompt>"                       find an accepted solution, or get a model brief',
    run: (app, args) => {
      const decision = new FrontDoor(app.lookup).route(positional(args, 0, "prompt"));
      return decision.kind === "suggestion" ? decision.reply : `No confident match. Model session brief:\n${decision.brief}`;
    },
  },
  {
    name: "accept",
    usage: 'accept <solutionId> --prompt "<p>" [--plan <name>]   add a suggestion to the implementation plan',
    run: (app, args) => {
      const solution = app.acceptSuggestion.execute(positional(args, 0, "solution id"), required(args, "prompt"),
        args.options.plan ?? "current");
      return `${solution.id} added to plan ${args.options.plan ?? "current"}.`;
    },
  },
  {
    name: "reject",
    usage: 'reject <solutionId> --prompt "<p>" --reason "<why>"  reject a suggestion; prints the model brief',
    run: (app, args) => app.rejectSuggestion
      .execute(positional(args, 0, "solution id"), required(args, "prompt"), required(args, "reason"))
      .toPrompt(),
  },
  {
    name: "plan",
    usage: "plan [--plan <name>]                      show the implementation plan",
    run: (app, args) => {
      const items = app.plan(args.options.plan ?? "current");
      return items.length ? items.map((s) => `- ${s.id}: ${s.summary}`).join("\n") : "The plan is empty.";
    },
  },
  {
    name: "propose",
    usage: 'propose --prompt "<p>" --summary "<s>" --diff-file <file>   save a draft solution',
    run: (app, args) => {
      const diff = args.options["diff-file"] ? readFileSync(args.options["diff-file"], "utf8") : "";
      const solution = app.proposeSolution.execute(required(args, "prompt"), required(args, "summary"), diff);
      return { text: `draft ${solution.id}`, remember: { solution: solution.id } };
    },
  },
  {
    name: "eval",
    usage: "eval <solutionId> --repo <mirror>         run every gate and SonarQube; lists what to fix; writes the PR report",
    run: async (app, args) => {
      const id = positional(args, 0, "solution id");
      const repo = required(args, "repo");
      const note = await app.linkRepository.uncommittedNote(repo);
      return withNote(note, renderer.evaluation(id, repo, await app.evaluateSolution.execute(id, repo)));
    },
  },
  {
    name: "revise",
    usage: 'revise <solutionId> --diff-file <file> [--summary "<s>"]   replace a draft\'s diff, for example after a failed eval',
    run: (app, args) => {
      const diff = readFileSync(required(args, "diff-file"), "utf8");
      const solution = app.reviseSolution.execute(positional(args, 0, "solution id"), diff, args.options.summary);
      return `draft ${solution.id} revised. Evaluate it again with eval.`;
    },
  },
  {
    name: "reopen",
    usage: "reopen <solutionId>                       hand an escalated solution back as a draft (a human only)",
    run: (app, args) => {
      const solution = app.reopenSolution.execute(positional(args, 0, "solution id"));
      return `${solution.id} is a draft again; its fix attempts start from zero.`;
    },
  },
  {
    name: "report",
    usage: 'report <solutionId> [--summary "<s>"]    (re)write the PR report',
    run: (app, args) => app.writeReport.execute(positional(args, 0, "solution id"), args.options.summary).markdown,
  },
  {
    name: "solution-accept",
    usage: "solution-accept <solutionId>              accept an evaluated solution; it can be suggested from now on",
    run: (app, args) => `${app.acceptSolution.execute(positional(args, 0, "solution id")).id} accepted.`,
  },
  {
    name: "applied",
    usage: "applied <solutionId> --repo <r> --commit <sha> --files a,b [--pr <url>]   record where it was applied",
    run: (app, args) => {
      app.recordApplication.execute({
        solutionId: positional(args, 0, "solution id"),
        repository: required(args, "repo"),
        commit: required(args, "commit"),
        files: required(args, "files").split(",").map((f) => f.trim()).filter(Boolean),
        ...(args.options.pr ? { pullRequestUrl: args.options.pr } : {}),
      });
      return "Recorded.";
    },
  },
];
