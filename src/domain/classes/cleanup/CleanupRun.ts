import { isRequired } from "../../helpers/cleanup/isRequired.js";
import type { Finding } from "../../interfaces/cleanup/Finding.js";
import type { RunProps } from "../../interfaces/cleanup/RunProps.js";
import type { Snapshot } from "../../interfaces/cleanup/Snapshot.js";
import type { CiState } from "../../types/cleanup/CiState.js";
import type { CleanupLevel } from "../../types/cleanup/CleanupLevel.js";
import type { RunState } from "../../types/cleanup/RunState.js";
import { DomainError } from "../errors/DomainError.js";

const RUN_TRANSITIONS: Record<RunState, RunState[]> = {
  analyzed: ["accepted", "abandoned"],
  accepted: ["in-progress", "abandoned"],
  "in-progress": ["ready", "abandoned"],
  ready: ["pushed", "abandoned"],
  // A failing CI on the pull request reopens the run for its `ci` batch.
  pushed: ["in-progress"],
  abandoned: [],
};

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
  get baseline(): Snapshot { return this.props.baseline; }
  get reference(): Snapshot { return this.props.reference; }
  get pullRequest(): string | undefined { return this.props.pullRequest; }
  get level(): CleanupLevel { return this.props.level ?? "verbose"; }
  get ci(): CiState | undefined { return this.props.ci?.state; }
  /** SonarQube findings below the run's level: never planned, left in SonarQube and counted in the PR. */
  get leftForLater(): Finding[] { return this.props.reference.findings.filter((f) => !isRequired(f, this.level)); }

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

  acceptMeasurement(snapshot: Snapshot): void {
    this.props.reference = snapshot;
  }

  recordCi(state: CiState, at = new Date()): void {
    this.requireState("pushed");
    this.props.ci = { state, checkedAt: at.toISOString() };
  }

  /** The base branch is gone on the remote: the PR goes into `base` instead. */
  retarget(base: string): void {
    if (!base.trim()) throw new DomainError("A base branch needs a name.");
    this.props.baseBranch = base;
  }

  published(pullRequest: string): void {
    this.moveTo("pushed");
    this.props.pullRequest = pullRequest;
  }

  toProps(): RunProps {
    return structuredClone(this.props);
  }
}
