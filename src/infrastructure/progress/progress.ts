import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Writable } from "node:stream";
import { PathGuard } from "../../domain/pathGuard.js";
import { isSessionName, type StepEvent, type StepStatus } from "../../domain/progress.js";
import type { IProgress, IProgressSink } from "../../ports/services.js";

/** Fans each step out to every attached listener. A listener that fails never stops the command. */
export class ProgressHub implements IProgress {
  private readonly sinks = new Set<IProgressSink>();
  private current = "aisdlc";

  get session(): string { return this.current; }

  /** The session the next steps belong to. */
  begin(session: string): void {
    this.current = session;
  }

  /** Returns a function that detaches the listener again. */
  attach(sink: IProgressSink): () => void {
    this.sinks.add(sink);
    return () => { this.sinks.delete(sink); };
  }

  emit(step: string, status: StepStatus, detail?: string): void {
    const event: StepEvent = { session: this.current, at: new Date().toISOString(), step, status, ...(detail ? { detail } : {}) };
    for (const sink of this.sinks) {
      try {
        sink.write(event);
      } catch {
        // Progress is for watching; a listener that cannot write must not fail the work.
      }
    }
  }
}

/** One JSON line per step in `work/sessions/<session>.jsonl`: what any listener of a session reads. */
export class SessionLog implements IProgressSink {
  private readonly root: PathGuard;

  constructor(private readonly folder: string) {
    this.root = new PathGuard(folder);
  }

  file(session: string): string {
    if (!isSessionName(session)) throw new Error(`Not a valid session name: ${session}`);
    return this.root.resolve(`${session}.jsonl`);
  }

  write(event: StepEvent): void {
    mkdirSync(this.folder, { recursive: true });
    appendFileSync(this.file(event.session), `${JSON.stringify(event)}\n`, "utf8");
  }

  /** The most recently written session, for `watch` without a name. */
  latest(): string | undefined {
    if (!existsSync(this.folder)) return undefined;
    return readdirSync(this.folder)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ name: f.slice(0, -".jsonl".length), at: statSync(path.join(this.folder, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)[0]?.name;
  }

  /** The events written from byte `from` on, and where the next read starts. A partial last line waits. */
  read(session: string, from = 0): { events: StepEvent[]; next: number } {
    const file = this.file(session);
    if (!existsSync(file)) return { events: [], next: from };
    const text = readFileSync(file).subarray(from).toString("utf8");
    const end = text.lastIndexOf("\n") + 1;
    const events = text.slice(0, end).split("\n").filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as StepEvent];
      } catch {
        return [];
      }
    });
    return { events, next: from + Buffer.byteLength(text.slice(0, end), "utf8") };
  }

  /** Prints the session so far, then each new step as it is written, until `signal` aborts. */
  async follow(session: string, print: (line: string) => void, signal: AbortSignal, intervalMs = 300): Promise<void> {
    let next = 0;
    while (!signal.aborted) {
      const read = this.read(session, next);
      read.events.forEach((e) => print(formatStep(e)));
      next = read.next;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, intervalMs);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  }
}

/** Prints each step as one line, for the person at the terminal. */
export class TerminalProgress implements IProgressSink {
  constructor(private readonly out: Writable) {}

  write(event: StepEvent): void {
    this.out.write(`${formatStep(event)}\n`);
  }
}

const MARK: Record<StepStatus, string> = { started: "..", done: "ok", failed: "!!", info: "--" };

export function formatStep(e: StepEvent): string {
  const time = new Date(e.at).toTimeString().slice(0, 8);
  return `[${time}] ${MARK[e.status]} ${e.step}${e.detail ? `: ${e.detail}` : ""}`;
}
