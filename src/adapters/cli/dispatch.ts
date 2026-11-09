import { parseArgs } from "node:util";
import { DomainError } from "../../domain/errors.js";
import type { RepositoryEntry } from "../../domain/repository.js";
import type { App } from "../composition.js";
import { COMMANDS, type CommandResult, type ParsedArgs } from "./commands.js";

const OPTIONS = ["prompt", "plan", "reason", "summary", "diff-file", "repo", "commit", "files", "pr", "by",
  "framework", "version", "from", "to", "steps-file", "name"] as const;

/** Every option the commands know, for completion. */
export const OPTION_NAMES = [...OPTIONS, "all"].map((o) => `--${o}`);

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

export function usage(): string {
  return ["Usage: aisdlc <command>, or aisdlc on its own for an interactive session", "",
    ...COMMANDS.map((c) => `  ${c.usage}`)].join("\n");
}

/** Asks a person a question at the terminal; undefined when there is no person to ask. */
export type Ask = (question: string) => Promise<string>;

/** Decisions a person makes. They need an interactive terminal, which a model's tool call does not have. */
const HUMAN_DECISIONS = new Set(["approve", "deny", "reopen"]);

export class CommandError extends Error {}

/**
 * Runs one parsed command. A human decision is refused without a person to ask, and asks y/N with one. With `cwd`,
 * a command that needs a repository and names none uses the git repository that folder is in.
 */
export async function dispatch(
  app: App, command: string, args: ParsedArgs, ask: Ask | undefined, cwd?: string,
): Promise<CommandResult> {
  const handler = COMMANDS.find((c) => c.name === command);
  if (!handler) throw new CommandError(`Unknown command ${command}.\n${usage()}`);
  if (HUMAN_DECISIONS.has(handler.name)) {
    if (!ask) throw new CommandError(`${command} needs a person at an interactive terminal. Run it yourself, not through an agent.`);
    const answer = await ask(`${command} ${describe(app, handler.name, args)}? [y/N] `);
    if (answer.trim().toLowerCase() !== "y") throw new CommandError("Nothing was changed.");
  }
  const picked = cwd ? await pickRepository(app, command, args, cwd) : undefined;
  const raw = await handler.run(app, args);
  const result = typeof raw === "string" ? { text: raw } : raw;
  if (!picked) return result;
  return {
    text: `using ${picked.kind === "mirror" ? "mirror" : "linked repository"} ${picked.name} (${picked.path})\n${result.text}`,
    remember: { ...result.remember, repo: picked.name },
  };
}

/** The repository of the current folder, for a command that needs one and was given none. Linked once. */
async function pickRepository(app: App, command: string, args: ParsedArgs, cwd: string): Promise<RepositoryEntry | undefined> {
  const [action, ...rest] = args.positionals;
  const needsRepo = (command === "eval" || command === "migrate") && !args.options.repo;
  const needsMirror = command === "cleanup" && action === "analyze" && rest.length === 0;
  if (!needsRepo && !needsMirror) return undefined;
  let entry: RepositoryEntry;
  try {
    ({ entry } = await app.linkRepository.execute(cwd));
  } catch (error) {
    // Not in a git repository: the command reports the missing --repo itself.
    if (error instanceof DomainError) return undefined;
    throw error;
  }
  if (needsRepo) args.options.repo = entry.name;
  else args.positionals.push(entry.name);
  return entry;
}

function describe(app: App, command: string, args: ParsedArgs): string {
  const id = args.positionals[0] ?? "";
  if (command === "reopen") return `solution ${id}: hand it back to the model as a draft`;
  const approval = app.approvals.get(id);
  return approval ? `${approval.kind} ${approval.target}: ${approval.reason}` : id;
}
