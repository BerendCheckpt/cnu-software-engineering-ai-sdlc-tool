import type { ShellContext } from "./ShellContext.js";

/** Output plus what a session should remember; a one-off command only prints the text. */
export interface CommandResult {
  text: string;
  remember?: ShellContext;
}
