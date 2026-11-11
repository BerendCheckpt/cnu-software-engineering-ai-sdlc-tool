import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import type { App } from "../composition.js";
import { parseCleanupLevel } from "../../domain/cleanup.js";
import { FrontDoor } from "../frontdoor/index.js";
import { CleanupRenderer, TextRenderer } from "../render.js";

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | undefined>;
}

/** What an interactive session remembers between commands, so ids are not typed twice. */
export interface ShellContext {
  repo?: string;
  solution?: string;
  run?: string;
  /** The session every command reports its steps to, when it was named at the start. */
  session?: string;
}

/** Output plus what a session should remember; a one-off command only prints the text. */
export interface CommandResult {
  text: string;
  remember?: ShellContext;
}

export interface CliCommand {
  readonly name: string;
  readonly usage: string;
  run(app: App, args: ParsedArgs): Promise<string | CommandResult> | string | CommandResult;
}

const renderer = new TextRenderer();
const cleanupRenderer = new CleanupRenderer(renderer);

function required(args: ParsedArgs, key: string): string {
  const value = args.options[key];
  if (!value) throw new Error(`--${key} is required.`);
  return value;
}

function positional(args: ParsedArgs, index: number, what: string): string {
  const value = args.positionals[index];
  if (!value) throw new Error(`Missing ${what}.`);
  return value;
}

function withNote(note: string | undefined, text: string): string {
  return note ? `${note}\n${text}` : text;
}

/** Whoever runs the CLI is the human who decides. */
const decider = (args: ParsedArgs) => args.options.by ?? userInfo().username;

export const COMMANDS: CliCommand[] = [
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
  {
    name: "approvals",
    usage: "approvals                                 list pending approvals, and approved ones not yet carried out",
    run: (app) => {
      const open = app.approvals.open();
      return open.length ? open.map((a) => renderer.approval(a)).join("\n") : "Nothing waiting for approval.";
    },
  },
  {
    name: "approve",
    usage: "approve <approvalId> [--by <name>]        approve, then carry it out once (re-run to retry a failure)",
    run: async (app, args) => {
      const approval = app.decideApproval.approve(positional(args, 0, "approval id"), decider(args));
      switch (approval.kind) {
        case "download": {
          const { file, chunks } = await app.pullDocs.execute(approval.id);
          return `Downloaded ${approval.target}: ${chunks} sections, ${file}`;
        }
        case "clone":
          return `Mirrored as ${await app.mirrorRepository.execute(approval.id)}.`;
        case "crystallize":
          return `Crystallized: ${app.crystallizeMigration.execute(approval)}`;
        default:
          return renderer.approval(approval);
      }
    },
  },
  {
    name: "deny",
    usage: "deny <approvalId> [--by <name>]",
    run: (app, args) => renderer.approval(app.decideApproval.deny(positional(args, 0, "approval id"), decider(args))),
  },
  {
    name: "docs",
    usage: "docs list | docs request <id...> | docs request --all | docs search \"<q>\" [--framework f] | docs reindex",
    run: (app, args) => {
      const [action, ...rest] = args.positionals;
      if (action === "list") {
        return app.sources.all().map((s) => `${app.hasDocs(s.id) ? "[x]" : "[ ]"} ${s.id} (${s.framework} ${s.version})`).join("\n");
      }
      if (action === "request") {
        const ids = args.options.all !== undefined ? app.sources.all().map((s) => s.id) : rest;
        return ids.map((id) => {
          const result = app.requestDocs.execute(id, "requested by an engineer");
          return result.kind === "requested" ? renderer.approval(result.approval) : `${id}: ${result.kind}`;
        }).join("\n");
      }
      if (action === "search") {
        return renderer.chunks(app.searchDocs.execute(rest.join(" "), args.options.framework, args.options.version));
      }
      if (action === "reindex") {
        const { reindexed, notArchived, failed } = app.reindexDocs.execute();
        return [
          ...reindexed.map((r) => `${r.id}: ${r.chunks} sections`),
          ...notArchived.map((id) => `${id}: not archived, download it again to change its sections`),
          ...failed.map((f) => `${f.id}: failed: ${f.error}`),
        ].join("\n") || "No downloaded docs to reindex.";
      }
      throw new Error("Use: docs list | docs request | docs search | docs reindex");
    },
  },
  {
    name: "repo",
    usage: "repo add <https-url> | repo link [<folder>] [--name <n>] | repo unlink <name> | repo list",
    run: async (app, args) => {
      switch (args.positionals[0]) {
        case "add":
          return renderer.approval(app.requestClone.execute(positional(args, 1, "repository URL"), "requested by an engineer"));
        case "link": {
          const { entry, created } = await app.linkRepository.execute(args.positionals[1] ?? process.cwd(), args.options.name);
          const text = created
            ? `Linked ${entry.name}: ${entry.path}. aisdlc only reads it; changes are made in copies.`
            : `${entry.path} is already known as ${entry.name} (${entry.kind}).`;
          return { text, remember: { repo: entry.name } };
        }
        case "unlink":
          app.linkRepository.unlink(positional(args, 1, "repository name"));
          return `Unlinked ${args.positionals[1]}. The folder itself was not touched.`;
        case "list": {
          const entries = app.linkRepository.list();
          return entries.length ? entries.map((e) => `${e.name} (${e.kind}): ${e.path}`).join("\n") : "No mirrors or linked folders.";
        }
        default:
          throw new Error("Use: repo add <https-url> | repo link [<folder>] [--name <n>] | repo unlink <name> | repo list");
      }
    },
  },
  {
    name: "cleanup",
    usage: "cleanup analyze <mirror> [--severity verbose|medium|high] | next <run> | check <run> | skip <run> --reason \"<why>\" | retry <run> | " +
      "escalate <run> | status <run> | finish <run>   automode: finish pushes and opens the PR; retry and escalate are " +
      "the engineer's choices for a batch that failed its last try",
    run: async (app, args) => {
      const [action] = args.positionals;
      const run = () => positional(args, 1, "clean-up run id");
      switch (action) {
        case "analyze": {
          const repo = positional(args, 1, "mirror name");
          const note = await app.linkRepository.uncommittedNote(repo);
          const level = parseCleanupLevel(args.options.severity);
          const analysis = await app.cleanup.analyze.execute(repo, args.options["run-id"], undefined, level);
          return { text: withNote(note, cleanupRenderer.analysis(analysis)), remember: { run: analysis.run.id } };
        }
        case "next":
          return cleanupRenderer.next(await app.cleanup.next.execute(run()));
        case "check": {
          // A batch that is done starts the next one right away, which saves the caller a round trip.
          const outcome = await app.cleanup.check.execute(run());
          const done = outcome.kind === "committed";
          return cleanupRenderer.check(outcome, run(), done ? await app.cleanup.next.execute(run()) : undefined);
        }
        // The engineer's two choices for a batch that failed its last try.
        case "retry":
          return `Batch retried: the count starts again.\n${cleanupRenderer.next(app.cleanup.retry.execute(run()))}`;
        case "escalate": {
          const outcome = await app.cleanup.escalate.execute(run());
          return cleanupRenderer.escalation(outcome, run(), await app.cleanup.next.execute(run()));
        }
        case "skip": {
          const batch = await app.cleanup.skip.execute(run(), required(args, "reason"));
          return `Batch ${batch.number} skipped.\n${cleanupRenderer.next(await app.cleanup.next.execute(run()))}`;
        }
        case "status": {
          const { run: current, batches } = app.cleanup.status.execute(run());
          return cleanupRenderer.status(current, batches);
        }
        case "finish": {
          const { reportPath, pullRequest, note } = await app.cleanup.finish.execute(run());
          return [`PR description: ${reportPath}`, ...(note ? [note] : []), `Pull request: ${pullRequest}`].join("\n");
        }
        default:
          throw new Error("Use: cleanup analyze | next | check | skip | retry | escalate | status | finish");
      }
    },
  },
  {
    name: "migrate",
    usage: "migrate --from <net9|angular20|js> --to <net10|angular22|ts> --repo <mirror>   initial migration plan",
    run: async (app, args) => {
      const repository = required(args, "repo");
      const note = await app.linkRepository.uncommittedNote(repository);
      return withNote(note, renderer.migration(await app.planMigration.execute({
        from: required(args, "from"),
        to: required(args, "to"),
        repository,
      })));
    },
  },
  {
    name: "crystallize",
    usage: "crystallize <solutionId> --from <f> --to <t> --steps-file <md>   draft a migration skill for a human to approve",
    run: (app, args) => {
      const { draftPath, approval } = app.requestCrystallization.execute(positional(args, 0, "solution id"),
        required(args, "from"), required(args, "to"), readFileSync(required(args, "steps-file"), "utf8"));
      return [`Draft: ${draftPath}`, `A human reviews it and approves: aisdlc approve ${approval.id}`].join("\n");
    },
  },
];
