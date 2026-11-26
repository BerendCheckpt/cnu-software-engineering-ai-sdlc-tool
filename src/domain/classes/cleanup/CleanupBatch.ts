import type { BatchProps } from "../../interfaces/cleanup/BatchProps.js";
import type { Finding } from "../../interfaces/cleanup/Finding.js";
import type { GateHit } from "../../interfaces/cleanup/GateHit.js";
import type { BatchCategory } from "../../types/cleanup/BatchCategory.js";
import type { BatchStatus } from "../../types/cleanup/BatchStatus.js";
import { DomainError } from "../errors/DomainError.js";

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
  get commitSha(): string | undefined { return this.props.commitSha; }
  get note(): string | undefined { return this.props.note; }
  get isOpen(): boolean { return this.props.status === "in-progress"; }
  get isWaiting(): boolean { return this.props.status === "waiting"; }
  get isFinished(): boolean {
    return this.props.status === "done" || this.props.status === "skipped" || this.props.status === "escalated";
  }

  start(baseSha: string): void {
    this.require("pending");
    this.props.status = "in-progress";
    this.props.baseSha = baseSha;
  }

  /** The PR's CI failed again after this `ci` batch was committed: it opens with the checks that fail now. */
  reopenForCi(findings: Finding[], baseSha: string): void {
    if (this.props.category !== "ci") throw new DomainError(`Batch ${this.number} is not the CI batch.`);
    this.require("done");
    this.props.status = "in-progress";
    this.props.findings = findings;
    this.props.baseSha = baseSha;
  }

  recordFailedCheck(): void {
    this.requireOpen();
    this.props.attempts++;
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

  /** The last allowed try failed: the batch stops, with its change kept, until the engineer decides. */
  waitForEngineer(): void {
    this.requireOpen();
    this.props.status = "waiting";
  }

  /** The engineer gives the batch another set of tries. */
  retry(): void {
    this.require("waiting");
    this.props.status = "in-progress";
  }

  /**
   * The engineer chose a PR with issues for what is left. `where` lists the issues, or where their text is;
   * `commitSha` is set when the batch's change made nothing worse and was committed.
   */
  escalate(where: string, commitSha?: string, gates: GateHit[] = this.props.gates): void {
    this.require("waiting");
    this.props.status = "escalated";
    this.props.note = `escalated: ${where}`;
    this.props.gates = commitSha ? gates : [];
    if (commitSha) this.props.commitSha = commitSha;
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
