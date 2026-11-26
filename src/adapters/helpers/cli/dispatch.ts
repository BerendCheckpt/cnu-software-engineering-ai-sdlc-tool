import { newRunId } from "../../../application/helpers/cleanup/newRunId.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { sessionName } from "../../../domain/helpers/progress/sessionName.js";
import type { RepositoryEntry } from "../../../domain/interfaces/repository/RepositoryEntry.js";
import { errorMessage } from "../../../shared/helpers/errors/errorMessage.js";
import { CommandError } from "../../classes/cli/CommandError.js";
import { COMMANDS } from "../../constants/cli/COMMANDS.js";
import type { CommandResult } from "../../interfaces/cli/CommandResult.js";
import type { ParsedArgs } from "../../interfaces/cli/ParsedArgs.js";
import type { Ask } from "../../types/cli/Ask.js";
import type { App } from "../../types/composition/App.js";
import { usage } from "./usage.js";

/** Decisions a person makes. They need an interactive terminal, which a model's tool call does not have. */
const HUMAN_DECISIONS = new Set(["approve", "deny", "reopen"]);

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
  const session = beginSession(app, command, args);
  try {
    const picked = cwd ? await pickRepository(app, command, args, cwd) : undefined;
    const raw = await handler.run(app, args);
    const result = typeof raw === "string" ? { text: raw } : raw;
    const header = [
      ...(session ? [`session: ${session} (follow it with: aisdlc watch ${session})`] : []),
      ...(picked ? [`using ${picked.kind === "mirror" ? "mirror" : "linked repository"} ${picked.name} (${picked.path})`] : []),
    ];
    return {
      text: [...header, result.text].join("\n"),
      ...(picked || result.remember ? { remember: { ...result.remember, ...(picked ? { repo: picked.name } : {}) } } : {}),
    };
  } catch (error) {
    if (session) app.progress.emit(command, "failed", errorMessage(error).split("\n")[0]);
    throw error;
  }
}

/**
 * Names the session of a clean-up command and points the steps at it: the name given with `--session` (a Claude
 * Code session passes its own), or `cleanup-<run_id>-DD-MM-YYYY-HHmmss` with the time of the run's branch, so every
 * command of one run reports to the same session. Other commands report no steps.
 */
function beginSession(app: App, command: string, args: ParsedArgs): string | undefined {
  if (command !== "cleanup") return undefined;
  const [action, runId] = args.positionals;
  let id = action === "analyze" ? undefined : runId;
  const now = new Date();
  let stamp: string | undefined;
  if (action === "analyze") {
    id = args.options["run-id"] = newRunId();
    args.options["run-at"] = now.toISOString();
  } else if (id) {
    stamp = runStamp(app, id);
  }
  const name = sessionName(command, { given: args.options.session, runId: id, stamp }, now);
  app.progress.begin(name);
  return name;
}

/** The time part of a run's branch, `cleanup/<stamp>`; none for a run that does not exist. */
function runStamp(app: App, runId: string): string | undefined {
  try {
    return app.cleanup.status.execute(runId).run.branch.replace(/^cleanup\//, "");
  } catch {
    return undefined;
  }
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
