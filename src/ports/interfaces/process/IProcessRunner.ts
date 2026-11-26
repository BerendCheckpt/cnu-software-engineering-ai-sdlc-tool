import type { ProcessResult } from "./ProcessResult.js";

/** Runs a program without a shell, so arguments are never interpreted. */
export interface IProcessRunner {
  run(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<ProcessResult>;
}
