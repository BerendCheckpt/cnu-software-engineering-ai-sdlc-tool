import type { StepEvent } from "../../../domain/interfaces/progress/StepEvent.js";
import type { StepStatus } from "../../../domain/types/progress/StepStatus.js";
import type { IProgress } from "../../../ports/interfaces/progress/IProgress.js";
import type { IProgressSink } from "../../../ports/interfaces/progress/IProgressSink.js";

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
