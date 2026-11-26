import type { FixAttempt } from "../../interfaces/quality/FixAttempt.js";
import type { FixLoopProps } from "../../interfaces/quality/FixLoopProps.js";
import type { FixLoopState } from "../../types/quality/FixLoopState.js";
import type { FixVerdict } from "../../types/quality/FixVerdict.js";
import { DomainError } from "../errors/DomainError.js";
import { QualityPolicy } from "./QualityPolicy.js";

/**
 * The checks of one task, kept by the tool and never by the model. A task may fail its first check and then
 * `maxFixAttempts` more; the failure after that goes to a human. Only a human reopens it.
 */
export class FixLoop {
  private constructor(private props: FixLoopProps) {}

  static start(subject: string): FixLoop {
    return new FixLoop({ subject, state: "open", attempts: [] });
  }

  static restore(props: FixLoopProps): FixLoop {
    return new FixLoop(structuredClone(props));
  }

  get subject(): string { return this.props.subject; }
  get state(): FixLoopState { return this.props.state; }
  get attempts(): FixAttempt[] { return this.props.attempts; }
  get escalation(): string | undefined { return this.props.escalation; }
  /** Failed checks in the current round; a human's `reopen` starts a new round. */
  get failures(): number { return this.props.attempts.slice(this.props.roundStart ?? 0).filter(failed).length; }
  /** Every failed check, earlier rounds included. */
  get failedAttempts(): FixAttempt[] { return this.props.attempts.filter(failed); }
  get last(): FixAttempt | undefined { return this.props.attempts.at(-1); }

  /** `maxFixAttempts` overrides the policy's, for a task with its own budget such as a clean-up batch. */
  record(attempt: FixAttempt, policy: QualityPolicy, maxFixAttempts = policy.maxFixAttempts): FixVerdict {
    if (this.props.state === "escalated") {
      throw new DomainError(`${this.subject} was escalated to a human (${this.props.escalation ?? "see the work folder"}).`);
    }
    this.props.attempts.push(attempt);
    if (!failed(attempt)) {
      this.props.state = "clean";
      return { kind: "clean" };
    }
    this.props.state = "open";
    const failures = this.failures;
    return failures > maxFixAttempts
      ? { kind: "escalate", failures }
      : { kind: "fix-required", failures, maxFixAttempts };
  }

  escalated(where: string): void {
    this.props.state = "escalated";
    this.props.escalation = where;
  }

  /** A human took the escalation and hands the task back: the count starts again; the earlier tries stay as history. */
  reopen(): void {
    if (this.props.state !== "escalated") throw new DomainError(`${this.subject} is not escalated.`);
    this.props = { subject: this.props.subject, state: "open", attempts: this.props.attempts, roundStart: this.props.attempts.length };
  }

  toProps(): FixLoopProps {
    return structuredClone(this.props);
  }
}

function failed(a: FixAttempt): boolean {
  return a.blocking.length > 0 || a.problems.length > 0;
}
