import type { CliCommand } from "../../interfaces/cli/CliCommand.js";
import { APPROVAL_COMMANDS } from "./APPROVAL_COMMANDS.js";
import { CLEANUP_COMMANDS } from "./CLEANUP_COMMANDS.js";
import { DOCS_COMMANDS } from "./DOCS_COMMANDS.js";
import { MIGRATION_COMMANDS } from "./MIGRATION_COMMANDS.js";
import { REPO_COMMANDS } from "./REPO_COMMANDS.js";
import { SOLUTION_COMMANDS } from "./SOLUTION_COMMANDS.js";

/** Every CLI command, in the order `usage` lists them. */
export const COMMANDS: CliCommand[] = [
  ...SOLUTION_COMMANDS,
  ...APPROVAL_COMMANDS,
  ...DOCS_COMMANDS,
  ...REPO_COMMANDS,
  ...CLEANUP_COMMANDS,
  ...MIGRATION_COMMANDS,
];
