import { parseCleanupLevel } from "../../../domain/helpers/cleanup/parseCleanupLevel.js";
import { CleanupRenderer } from "../../classes/render/CleanupRenderer.js";
import { TextRenderer } from "../../classes/render/TextRenderer.js";
import { positional } from "../../helpers/cli/positional.js";
import { required } from "../../helpers/cli/required.js";
import { withNote } from "../../helpers/cli/withNote.js";
import type { CliCommand } from "../../interfaces/cli/CliCommand.js";

const cleanupRenderer = new CleanupRenderer(new TextRenderer());

/** The clean-up run in automode: analyze, work through the batches, finish with a PR, then follow its CI. */
export const CLEANUP_COMMANDS: CliCommand[] = [
  {
    name: "cleanup",
    usage: "cleanup analyze <mirror> [--severity verbose|medium|high] | next <run> | check <run> | skip <run> --reason \"<why>\" | retry <run> | " +
      "escalate <run> | status <run> | finish <run> | ci <run>   automode: finish pushes and opens the PR; ci reads its " +
      "checks once and opens a batch for the failing ones; retry and escalate are the engineer's choices for a batch " +
      "that failed its last try",
    run: async (app, args) => {
      const [action] = args.positionals;
      const run = () => positional(args, 1, "clean-up run id");
      switch (action) {
        case "analyze": {
          const repo = positional(args, 1, "mirror name");
          const note = await app.linkRepository.uncommittedNote(repo);
          const at = args.options["run-at"];
          const level = parseCleanupLevel(args.options.severity);
          const analysis = await app.cleanup.analyze.execute(repo, args.options["run-id"], at ? new Date(at) : undefined, level);
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
          return [`PR description: ${reportPath}`, ...(note ? [note] : []), `Pull request: ${pullRequest}`,
            `When its CI has finished: aisdlc cleanup ci ${run()}`].join("\n");
        }
        case "ci":
          return cleanupRenderer.ci(await app.cleanup.ci.execute(run()));
        default:
          throw new Error("Use: cleanup analyze | next | check | skip | retry | escalate | status | finish | ci");
      }
    },
  },
];
