import type { App } from "../../types/composition/App.js";
import type { CommandResult } from "./CommandResult.js";
import type { ParsedArgs } from "./ParsedArgs.js";

export interface CliCommand {
  readonly name: string;
  readonly usage: string;
  run(app: App, args: ParsedArgs): Promise<string | CommandResult> | string | CommandResult;
}
