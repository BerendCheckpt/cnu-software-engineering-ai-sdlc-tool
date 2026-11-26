import { DomainError } from "../../classes/errors/DomainError.js";
import { SESSION } from "../../constants/progress/SESSION.js";
import { timeStamp } from "./timeStamp.js";

/**
 * The session a command reports to. A name given by the caller wins (a Claude Code session passes its own name);
 * otherwise `<command>-<run_id>-DD-MM-YYYY-HHmmss`, or `<command>-DD-MM-YYYY-HHmmss` for a command without a run.
 */
export function sessionName(command: string, from: { given?: string; runId?: string; stamp?: string }, now = new Date()): string {
  const name = from.given ?? [command, from.runId, from.stamp ?? timeStamp(now)].filter(Boolean).join("-");
  if (!SESSION.test(name)) throw new DomainError(`Not a valid session name: ${name}. Use letters, digits, '.', '_' and '-'.`);
  return name;
}
