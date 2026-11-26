import type { ParsedArgs } from "../../interfaces/cli/ParsedArgs.js";

/** The value of option `--key`, or an error that says it is required. */
export function required(args: ParsedArgs, key: string): string {
  const value = args.options[key];
  if (!value) throw new Error(`--${key} is required.`);
  return value;
}
