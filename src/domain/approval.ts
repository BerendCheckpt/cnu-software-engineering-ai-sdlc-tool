import { randomBytes } from "node:crypto";
import { DomainError } from "./errors.js";

/** The clean-up needs none: it runs in automode and the pull request is the review. */
export type ApprovalKind = "download" | "clone" | "crystallize";
export type ApprovalStatus = "pending" | "approved" | "denied" | "executed";

export interface ApprovalProps {
  id: string;
  kind: ApprovalKind;
  target: string;
  reason: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
}

/**
 * Permission for one action with an outside effect. Anyone may request one; only a human decides it,
 * and an approved action runs once.
 */
export class Approval {
  private constructor(private props: ApprovalProps) {}

  static request(kind: ApprovalKind, target: string, reason: string): Approval {
    if (!target.trim()) throw new DomainError("An approval needs a target.");
    return new Approval({
      // Unguessable, so text in a prompt or a document cannot name an approval it never saw.
      id: randomBytes(6).toString("hex"),
      kind,
      target,
      reason,
      status: "pending",
      requestedAt: new Date().toISOString(),
    });
  }

  static restore(props: ApprovalProps): Approval {
    return new Approval({ ...props });
  }

  get id(): string { return this.props.id; }
  get kind(): ApprovalKind { return this.props.kind; }
  get target(): string { return this.props.target; }
  get reason(): string { return this.props.reason; }
  get status(): ApprovalStatus { return this.props.status; }

  approve(decidedBy: string): void {
    this.decide("approved", decidedBy);
  }

  deny(decidedBy: string): void {
    this.decide("denied", decidedBy);
  }

  ensureApprovedFor(kind: ApprovalKind): void {
    if (this.props.kind !== kind) throw new DomainError(`Approval ${this.id} is for a ${this.props.kind}, not a ${kind}.`);
    if (this.props.status !== "approved") throw new DomainError(`Approval ${this.id} is ${this.props.status}, not approved.`);
  }

  /** Marks the approved action as done, so it cannot run a second time. */
  consume(kind: ApprovalKind): void {
    this.ensureApprovedFor(kind);
    this.props.status = "executed";
  }

  toProps(): ApprovalProps {
    return { ...this.props };
  }

  private decide(status: "approved" | "denied", decidedBy: string): void {
    if (this.props.status !== "pending") throw new DomainError(`Approval ${this.id} is already ${this.props.status}.`);
    if (!decidedBy.trim()) throw new DomainError("A decision needs the name of the person who made it.");
    this.props.status = status;
    this.props.decidedBy = decidedBy;
    this.props.decidedAt = new Date().toISOString();
  }
}
