import type { ParsedArgs } from "../../interfaces/cli/ParsedArgs.js";

/** The positional argument at `index`, or an error that names `what` is missing. */
export function positional(args: ParsedArgs, index: number, what: string): string {
  const value = args.positionals[index];
  if (!value) throw new Error(`Missing ${what}.`);
  return value;
}
