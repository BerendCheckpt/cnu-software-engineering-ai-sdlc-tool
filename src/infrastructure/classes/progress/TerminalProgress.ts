import type { Writable } from "node:stream";
import type { StepEvent } from "../../../domain/interfaces/progress/StepEvent.js";
import type { IProgressSink } from "../../../ports/interfaces/progress/IProgressSink.js";
import { formatStep } from "../../helpers/progress/formatStep.js";

/** Prints each step as one line, for the person at the terminal. */
export class TerminalProgress implements IProgressSink {
  constructor(private readonly out: Writable) {}

  write(event: StepEvent): void {
    this.out.write(`${formatStep(event)}\n`);
  }
}
