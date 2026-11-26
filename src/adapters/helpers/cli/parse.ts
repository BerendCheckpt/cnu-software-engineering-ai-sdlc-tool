import { parseArgs } from "node:util";
import { OPTIONS } from "../../constants/cli/OPTIONS.js";
import type { ParsedArgs } from "../../interfaces/cli/ParsedArgs.js";

export function parse(argv: string[]): { command?: string; args: ParsedArgs } {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...Object.fromEntries(OPTIONS.map((o) => [o, { type: "string" as const }])),
      all: { type: "boolean" },
    },
  });
  const options = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, typeof v === "boolean" ? (v ? "" : undefined) : (v as string | undefined)]));
  const [command, ...rest] = positionals;
  return { command, args: { positionals: rest, options } };
}
