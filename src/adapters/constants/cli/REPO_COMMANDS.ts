import { TextRenderer } from "../../classes/render/TextRenderer.js";
import { positional } from "../../helpers/cli/positional.js";
import type { CliCommand } from "../../interfaces/cli/CliCommand.js";

const renderer = new TextRenderer();

/** Mirrors and linked folders: the repositories aisdlc reads from. */
export const REPO_COMMANDS: CliCommand[] = [
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
];
