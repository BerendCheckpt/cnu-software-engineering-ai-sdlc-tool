import type { Finding } from "./cleanup.js";
import { DomainError } from "./errors.js";

/** SonarQube's impact severities, most severe first. */
export const SEVERITIES = ["BLOCKER", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Older SonarQube severities, gitleaks' CRITICAL and npm audit's MODERATE, mapped to impact severities. */
const LEGACY: Record<string, Severity> = { CRITICAL: "HIGH", MAJOR: "MEDIUM", MODERATE: "MEDIUM", MINOR: "LOW" };

/** Maps any severity a tool reports, old or new, to an impact severity. Unknown values count as INFO. */
export function normalizeSeverity(severity: string): Severity {
  const upper = severity.trim().toUpperCase();
  if ((SEVERITIES as readonly string[]).includes(upper)) return upper as Severity;
  return LEGACY[upper] ?? "INFO";
}

/** Most severe first; findings of equal severity keep their order. */
export function bySeverity<T extends { severity: string }>(items: T[]): T[] {
  const rank = (s: string) => SEVERITIES.indexOf(normalizeSeverity(s));
  return [...items].sort((a, b) => rank(a.severity) - rank(b.severity));
}

/** Which SonarQube findings stop a task, which are only reported, and how often the model may try again. */
export class QualityPolicy {
  private readonly blockingSet: Set<Severity>;
  private readonly reportedSet: Set<Severity>;

  constructor(blocking: string[], reported: string[], readonly maxFixAttempts: number) {
    if (!Number.isInteger(maxFixAttempts) || maxFixAttempts < 0) {
      throw new DomainError("maxFixAttempts must be a whole number of 0 or more.");
    }
    this.blockingSet = new Set(blocking.map(normalizeSeverity));
    this.reportedSet = new Set(reported.map(normalizeSeverity).filter((s) => !this.blockingSet.has(s)));
  }

  /** Open SonarQube issues the task must fix before it is done. */
  blocking(findings: Finding[]): Finding[] {
    return findings.filter((f) => isSonar(f) && this.blockingSet.has(normalizeSeverity(f.severity)));
  }

  /** Open SonarQube issues the model is asked to fix, but that never fail a check. */
  reported(findings: Finding[]): Finding[] {
    return findings.filter((f) => isSonar(f) && this.reportedSet.has(normalizeSeverity(f.severity)));
  }
}

function isSonar(f: Finding): boolean {
  return f.source.toLowerCase() === "sonar";
}

// ---------------------------------------------------------------------------------------------------------------

/** One check of a task. It failed when a blocking issue was open or something else got worse. */
export interface FixAttempt {
  at: string;
  blocking: Finding[];
  reported: Finding[];
  /** Everything else that failed: a gate, a regression. */
  problems: string[];
}

export type FixLoopState = "open" | "clean" | "escalated";

export interface FixLoopProps {
  /** `solution:<id>` or `cleanup:<runId>#<batch>`. */
  subject: string;
  state: FixLoopState;
  attempts: FixAttempt[];
  /** The GitHub issue, or where its text was written when it could not be created. */
  escalation?: string;
}

export type FixVerdict =
  | { kind: "clean" }
  | { kind: "fix-required"; failures: number; maxFixAttempts: number }
  | { kind: "escalate"; failures: number };

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
  get failures(): number { return this.props.attempts.filter(failed).length; }
  get last(): FixAttempt | undefined { return this.props.attempts.at(-1); }

  record(attempt: FixAttempt, policy: QualityPolicy): FixVerdict {
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
    return failures > policy.maxFixAttempts
      ? { kind: "escalate", failures }
      : { kind: "fix-required", failures, maxFixAttempts: policy.maxFixAttempts };
  }

  escalated(where: string): void {
    this.props.state = "escalated";
    this.props.escalation = where;
  }

  /** A human took the escalation and hands the task back: the count starts again. */
  reopen(): void {
    if (this.props.state !== "escalated") throw new DomainError(`${this.subject} is not escalated.`);
    this.props = { subject: this.props.subject, state: "open", attempts: [] };
  }

  toProps(): FixLoopProps {
    return structuredClone(this.props);
  }
}

function failed(a: FixAttempt): boolean {
  return a.blocking.length > 0 || a.problems.length > 0;
}
