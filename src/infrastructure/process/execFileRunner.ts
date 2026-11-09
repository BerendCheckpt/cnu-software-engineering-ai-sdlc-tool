import { execFile } from "node:child_process";
import type { IProcessRunner, ProcessResult } from "../../ports/services.js";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Runs a program with `execFile` and `shell: false`: arguments reach the program as given, never via a shell. */
export class ExecFileRunner implements IProcessRunner {
  run(command: string, args: string[], cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProcessResult> {
    return new Promise((resolve) => {
      execFile(command, args, { cwd, shell: false, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
          resolve({ exitCode: code, stdout: String(stdout), stderr: String(stderr || (error?.message ?? "")) });
        });
    });
  }
}
