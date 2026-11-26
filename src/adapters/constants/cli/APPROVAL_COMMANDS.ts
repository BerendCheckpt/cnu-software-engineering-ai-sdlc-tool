import { userInfo } from "node:os";
import { TextRenderer } from "../../classes/render/TextRenderer.js";
import { positional } from "../../helpers/cli/positional.js";
import type { CliCommand } from "../../interfaces/cli/CliCommand.js";
import type { ParsedArgs } from "../../interfaces/cli/ParsedArgs.js";

const renderer = new TextRenderer();

/** Whoever runs the CLI is the human who decides. */
const decider = (args: ParsedArgs) => args.options.by ?? userInfo().username;

/** The human approval gate: list, approve (and carry out once) or deny. */
export const APPROVAL_COMMANDS: CliCommand[] = [
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
];
