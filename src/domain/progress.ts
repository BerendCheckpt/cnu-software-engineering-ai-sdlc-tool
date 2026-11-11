import { DomainError } from "./errors.js";

export type StepStatus = "started" | "done" | "failed" | "info";

/** One step of a command, as listeners of a session see it. */
export interface StepEvent {
  session: string;
  /** ISO time. */
  at: string;
  step: string;
  status: StepStatus;
  detail?: string;
}

const SESSION = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * `DD-MM-YYYY-HHmmss` in local time: the time part of session and branch names, so several runs on one day each
 * get their own branch.
 */
export function timeStamp(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(now.getDate())}-${two(now.getMonth() + 1)}-${now.getFullYear()}-` +
    `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

/**
 * The session a command reports to. A name given by the caller wins (a Claude Code session passes its own name);
 * otherwise `<command>-<run_id>-DD-MM-YYYY-HHmmss`, or `<command>-DD-MM-YYYY-HHmmss` for a command without a run.
 */
export function sessionName(command: string, from: { given?: string; runId?: string; stamp?: string }, now = new Date()): string {
  const name = from.given ?? [command, from.runId, from.stamp ?? timeStamp(now)].filter(Boolean).join("-");
  if (!SESSION.test(name)) throw new DomainError(`Not a valid session name: ${name}. Use letters, digits, '.', '_' and '-'.`);
  return name;
}

export function isSessionName(name: string): boolean {
  return SESSION.test(name);
}
