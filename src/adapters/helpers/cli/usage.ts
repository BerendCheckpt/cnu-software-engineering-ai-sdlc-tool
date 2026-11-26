import { COMMANDS } from "../../constants/cli/COMMANDS.js";

export function usage(): string {
  return ["Usage: aisdlc <command> [--session <name>], or aisdlc on its own for an interactive session", "",
    ...COMMANDS.map((c) => `  ${c.usage}`),
    "  watch [<session>]                         follow a session's steps live (the latest one without a name)"].join("\n");
}
