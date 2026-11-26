import { readFileSync } from "node:fs";
import { TextRenderer } from "../../classes/render/TextRenderer.js";
import { positional } from "../../helpers/cli/positional.js";
import { required } from "../../helpers/cli/required.js";
import { withNote } from "../../helpers/cli/withNote.js";
import type { CliCommand } from "../../interfaces/cli/CliCommand.js";

const renderer = new TextRenderer();

/** Migration plans, and turning a finished migration into a skill. */
export const MIGRATION_COMMANDS: CliCommand[] = [
  {
    name: "migrate",
    usage: "migrate --from <net9|angular20|js|ckp-retailerplugin> --to <net10|angular22|ts|cnu-retailerplugin> " +
      "--repo <mirror>   initial migration plan, or the agent that does it",
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
