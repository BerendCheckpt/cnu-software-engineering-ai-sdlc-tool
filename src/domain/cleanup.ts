import { DomainError } from "./errors.js";
import type { EvaluationKind, TestCounts } from "./evaluation.js";

/** Ordered from most to least urgent; the plan follows this order unless the policy says otherwise. */
export const FINDING_CATEGORIES = ["security", "bug", "dependency", "maintainability", "readability"] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/** One problem a tool reported. It never carries a secret's value, only where it is and which rule found it. */
export interface Finding {
  source: string;
  rule: string;
  category: FindingCategory;
  severity: string;
  file: string;
  line?: number;
  message: string;
}

/**
 * Identifies a finding across runs. The line is left out on purpose: fixing something above it moves it,
 * and a moved finding is not a new one.
 */
export function findingKey(f: Finding): string {
  return [f.source, f.rule, f.file, f.message].join("|");
}

/** Changes a human has to look at before they are committed. Decided from the diff, never by the model. */
export type Gate = "tests" | "dependency" | "security";

export interface GateHit {
  gate: Gate;
  files: string[];
}

/** One gate's outcome in a measurement of the workspace. */
export interface GateSnapshot {
  kind: EvaluationKind;
  passed: boolean;
  skipped: boolean;
  tests?: TestCounts;
  coverage?: number;
}

/** Everything measured about the workspace at one moment: gate outcomes and open findings. */
export interface Snapshot {
  gates: GateSnapshot[];
  findings: Finding[];
  /** What this measurement could not cover, shown in the plan and the report. */
  limitations?: string[];
}

// ---------------------------------------------------------------------------------------------------------------

export type BatchCategory = FindingCategory | "format";
/** `escalated`: the model failed its checks too often; the change was reset and a human has the issue. */
export type BatchStatus = "pending" | "in-progress" | "awaiting-approval" | "done" | "skipped" | "escalated";

export interface BatchProps {
  runId: string;
  number: number;
  category: BatchCategory;
  findings: Finding[];
  status: BatchStatus;
  /** HEAD when the batch started; its diff is everything since, so a commit by the model cannot hide a change. */
  baseSha?: string;
  attempts: number;
  gates: GateHit[];
  /** The reviewed diff. A change after review needs a new check and a new approval. */
  diffHash?: string;
  approvalId?: string;
  /** The measurement that becomes the run's reference once the batch is approved. */
  candidate?: Snapshot;
  commitSha?: string;
  note?: string;
}

/** A small, reviewable piece of the clean-up: one category, a few findings, a few files. */
export class CleanupBatch {
  private constructor(private props: BatchProps) {}

  static plan(runId: string, number: number, category: BatchCategory, findings: Finding[]): CleanupBatch {
    return new CleanupBatch({ runId, number, category, findings, status: "pending", attempts: 0, gates: [] });
  }

  static restore(props: BatchProps): CleanupBatch {
    return new CleanupBatch(structuredClone(props));
  }

  get runId(): string { return this.props.runId; }
  get number(): number { return this.props.number; }
  get category(): BatchCategory { return this.props.category; }
  get findings(): Finding[] { return this.props.findings; }
  get status(): BatchStatus { return this.props.status; }
  get baseSha(): string | undefined { return this.props.baseSha; }
  get attempts(): number { return this.props.attempts; }
  get gates(): GateHit[] { return this.props.gates; }
  get diffHash(): string | undefined { return this.props.diffHash; }
  get approvalId(): string | undefined { return this.props.approvalId; }
  get candidate(): Snapshot | undefined { return this.props.candidate; }
  get commitSha(): string | undefined { return this.props.commitSha; }
  get note(): string | undefined { return this.props.note; }
  get isOpen(): boolean { return this.props.status === "in-progress" || this.props.status === "awaiting-approval"; }
  get isFinished(): boolean {
    return this.props.status === "done" || this.props.status === "skipped" || this.props.status === "escalated";
  }

  start(baseSha: string): void {
    this.require("pending");
    this.props.status = "in-progress";
    this.props.baseSha = baseSha;
  }

  recordFailedCheck(): void {
    this.requireOpen();
    this.props.status = "in-progress";
    this.props.attempts++;
  }

  awaitApproval(gates: GateHit[], diffHash: string, approvalId: string, candidate: Snapshot): void {
    this.requireOpen();
    Object.assign(this.props, { status: "awaiting-approval", gates, diffHash, approvalId, candidate });
  }

  complete(commitSha: string | undefined, gates: GateHit[] = this.props.gates): void {
    this.requireOpen();
    this.props.status = "done";
    this.props.gates = gates;
    if (commitSha) this.props.commitSha = commitSha;
    else this.props.note = "nothing to change";
  }

  skip(reason: string): void {
    if (this.isFinished) throw new DomainError(`Batch ${this.number} is already ${this.status}.`);
    if (!reason.trim()) throw new DomainError("Skipping a batch needs a reason.");
    this.props.status = "skipped";
    this.props.note = reason;
  }

  /** `where` is the escalation issue, or where its text is. */
  escalate(where: string): void {
    this.requireOpen();
    this.props.status = "escalated";
    this.props.note = `escalated: ${where}`;
  }

  toProps(): BatchProps {
    return structuredClone(this.props);
  }

  private require(status: BatchStatus): void {
    if (this.props.status !== status) throw new DomainError(`Batch ${this.number} is ${this.props.status}, not ${status}.`);
  }

  private requireOpen(): void {
    if (!this.isOpen) throw new DomainError(`Batch ${this.number} is ${this.props.status}, not in progress.`);
  }
}

// ---------------------------------------------------------------------------------------------------------------

export type RunState = "analyzed" | "accepted" | "in-progress" | "ready" | "pushed" | "abandoned";

const RUN_TRANSITIONS: Record<RunState, RunState[]> = {
  analyzed: ["accepted", "abandoned"],
  accepted: ["in-progress", "abandoned"],
  "in-progress": ["ready", "abandoned"],
  ready: ["pushed", "abandoned"],
  pushed: [],
  abandoned: [],
};

export interface RunProps {
  id: string;
  repository: string;
  workspace: string;
  branch: string;
  baseBranch: string;
  state: RunState;
  planApprovalId?: string;
  /** The measurement before anything changed. */
  baseline: Snapshot;
  /** The latest measurement a human accepted, directly or by approving a batch; each check is compared with it. */
  reference: Snapshot;
  pullRequest?: string;
  createdAt: string;
}

/** One clean-up of one repository, from the first measurement to a pushed branch. */
export class CleanupRun {
  private constructor(private props: RunProps) {}

  static start(props: Omit<RunProps, "state" | "reference" | "createdAt">): CleanupRun {
    return new CleanupRun({ ...props, state: "analyzed", reference: props.baseline, createdAt: new Date().toISOString() });
  }

  static restore(props: RunProps): CleanupRun {
    return new CleanupRun(structuredClone(props));
  }

  get id(): string { return this.props.id; }
  get repository(): string { return this.props.repository; }
  get workspace(): string { return this.props.workspace; }
  get branch(): string { return this.props.branch; }
  get baseBranch(): string { return this.props.baseBranch; }
  get state(): RunState { return this.props.state; }
  get planApprovalId(): string | undefined { return this.props.planApprovalId; }
  get baseline(): Snapshot { return this.props.baseline; }
  get reference(): Snapshot { return this.props.reference; }
  get pullRequest(): string | undefined { return this.props.pullRequest; }

  moveTo(next: RunState): void {
    if (this.props.state === next) return;
    if (!RUN_TRANSITIONS[this.props.state].includes(next)) {
      throw new DomainError(`Clean-up ${this.id} cannot go from ${this.props.state} to ${next}.`);
    }
    this.props.state = next;
  }

  requireState(...states: RunState[]): void {
    if (!states.includes(this.props.state)) {
      throw new DomainError(`Clean-up ${this.id} is ${this.props.state}; this needs ${states.join(" or ")}.`);
    }
  }

  awaitPlanApproval(approvalId: string): void {
    this.props.planApprovalId = approvalId;
  }

  acceptMeasurement(snapshot: Snapshot): void {
    this.props.reference = snapshot;
  }

  published(pullRequest: string): void {
    this.moveTo("pushed");
    this.props.pullRequest = pullRequest;
  }

  toProps(): RunProps {
    return structuredClone(this.props);
  }
}

// ---------------------------------------------------------------------------------------------------------------

export interface ComparisonOptions {
  /** True when a human approved removing or rewriting tests, so fewer tests is not a problem. */
  fewerTestsApproved: boolean;
}

/**
 * Decides whether the workspace is still at least as good as a reference measurement. An empty list means it is;
 * otherwise each entry says what got worse. This is what "a valid PR" means in code.
 */
export class ValidPr {
  static problems(reference: Snapshot, current: Snapshot, options: ComparisonOptions): string[] {
    return [...this.gateProblems(reference, current, options), ...this.newFindings(reference, current)];
  }

  /** Findings that were open in the reference and are gone now. */
  static fixed(reference: Snapshot, current: Snapshot): Finding[] {
    const remaining = countByKey(current.findings);
    return reference.findings.filter((f) => {
      const left = remaining.get(findingKey(f)) ?? 0;
      if (left > 0) {
        remaining.set(findingKey(f), left - 1);
        return false;
      }
      return true;
    });
  }

  private static gateProblems(reference: Snapshot, current: Snapshot, options: ComparisonOptions): string[] {
    const problems: string[] = [];
    for (const before of reference.gates.filter((g) => !g.skipped)) {
      const now = current.gates.find((g) => g.kind === before.kind);
      if (!now || now.skipped) {
        problems.push(`${before.kind} ran before but did not run now`);
        continue;
      }
      if (before.passed && !now.passed) problems.push(`${before.kind} passed before and fails now`);
      problems.push(...this.testProblems(before, now, options));
      if (before.coverage !== undefined && now.coverage !== undefined && now.coverage < before.coverage) {
        problems.push(`${before.kind} coverage went down from ${before.coverage}% to ${now.coverage}%`);
      }
    }
    return problems;
  }

  private static testProblems(before: GateSnapshot, now: GateSnapshot, options: ComparisonOptions): string[] {
    if (!before.tests || !now.tests) return [];
    const problems: string[] = [];
    const knownFailures = new Set(before.tests.failing);
    const newFailures = now.tests.failing.filter((t) => !knownFailures.has(t));
    if (newFailures.length) problems.push(`${before.kind}: newly failing ${newFailures.slice(0, 5).join(", ")}`);
    if (now.tests.total < before.tests.total && !options.fewerTestsApproved) {
      problems.push(`${before.kind}: ${before.tests.total - now.tests.total} fewer tests than before`);
    }
    return problems;
  }

  private static newFindings(reference: Snapshot, current: Snapshot): string[] {
    const before = countByKey(reference.findings);
    const added = current.findings.filter((f) => {
      const left = before.get(findingKey(f)) ?? 0;
      if (left > 0) {
        before.set(findingKey(f), left - 1);
        return false;
      }
      return true;
    });
    return added.slice(0, 5).map((f) => `new ${f.source} finding ${f.rule} in ${f.file}${f.line ? `:${f.line}` : ""}`)
      .concat(added.length > 5 ? [`and ${added.length - 5} more new findings`] : []);
  }
}

function countByKey(findings: Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(findingKey(f), (counts.get(findingKey(f)) ?? 0) + 1);
  return counts;
}
