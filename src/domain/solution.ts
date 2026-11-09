import { randomUUID } from "node:crypto";
import { DomainError } from "./errors.js";

/** `escalated`: the model failed its checks too often; a human took it over and only a human reopens it. */
export type SolutionState =
  "draft" | "evaluated" | "accepted" | "rejected" | "crystallized" | "deprecated" | "escalated";

const TRANSITIONS: Record<SolutionState, SolutionState[]> = {
  draft: ["evaluated", "rejected", "escalated"],
  evaluated: ["accepted", "rejected"],
  accepted: ["crystallized", "deprecated"],
  crystallized: ["deprecated"],
  rejected: [],
  deprecated: [],
  escalated: ["draft", "rejected"],
};

export interface SolutionProps {
  id: string;
  prompt: string;
  summary: string;
  diff: string;
  state: SolutionState;
  createdAt: string;
}

/** A proposed answer to a prompt. Only accepted and crystallized solutions are ever suggested. */
export class Solution {
  private constructor(private props: SolutionProps) {}

  static propose(prompt: string, summary: string, diff: string): Solution {
    if (!prompt.trim() || !summary.trim()) throw new DomainError("A solution needs a prompt and a summary.");
    return new Solution({
      id: randomUUID(),
      prompt,
      summary,
      diff,
      state: "draft",
      createdAt: new Date().toISOString(),
    });
  }

  static restore(props: SolutionProps): Solution {
    return new Solution({ ...props });
  }

  get id(): string { return this.props.id; }
  get prompt(): string { return this.props.prompt; }
  get summary(): string { return this.props.summary; }
  get diff(): string { return this.props.diff; }
  get state(): SolutionState { return this.props.state; }
  get createdAt(): string { return this.props.createdAt; }

  get isSuggestable(): boolean {
    return this.props.state === "accepted" || this.props.state === "crystallized";
  }

  /** A draft gets a new change, for example a fix after a failed check. Anything later is fixed for good. */
  revise(diff: string, summary?: string): void {
    if (this.props.state !== "draft") throw new DomainError(`Only a draft can be revised; this solution is ${this.props.state}.`);
    if (summary !== undefined && !summary.trim()) throw new DomainError("A solution needs a summary.");
    this.props.diff = diff;
    if (summary !== undefined) this.props.summary = summary;
  }

  moveTo(next: SolutionState): void {
    if (!TRANSITIONS[this.props.state].includes(next)) {
      throw new DomainError(`A ${this.props.state} solution cannot become ${next}.`);
    }
    this.props.state = next;
  }

  toProps(): SolutionProps {
    return { ...this.props };
  }
}
