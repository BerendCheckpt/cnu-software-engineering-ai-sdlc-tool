import type { LookupSolutions } from "../../application/lookupSolutions.js";
import { SessionBrief } from "../../domain/sessionBrief.js";
import { type App, createApp } from "../composition.js";
import { TextRenderer } from "../render.js";

export type FrontDoorDecision =
  /** Answer with this reply; no model is needed. */
  | { kind: "suggestion"; reply: string; solutionIds: string[] }
  /** Start a budgeted model session with this brief as its first message. */
  | { kind: "model"; brief: string };

/**
 * The deterministic step in front of any model (ADR 0001). cnu-claude-agent calls `route` before `query()`;
 * a suggestion is returned to the engineer as is, at zero model tokens.
 */
export class FrontDoor {
  constructor(
    private readonly lookup: LookupSolutions,
    private readonly renderer = new TextRenderer(),
  ) {}

  route(prompt: string): FrontDoorDecision {
    const result = this.lookup.execute(prompt);
    if (result.decision === "suggest") {
      return {
        kind: "suggestion",
        reply: [
          "An accepted solution exists for this request:",
          this.renderer.matches(result.matches),
          "Accept it to add it to your implementation plan, or reject it with a reason to work out a new one.",
        ].join("\n"),
        solutionIds: result.matches.map((m) => m.solution.id),
      };
    }
    return { kind: "model", brief: new SessionBrief(prompt, result.matches).toPrompt() };
  }
}

/** For callers outside this package: opens the knowledge store at `AISDLC_HOME`. */
export function createFrontDoor(app: App = createApp()): FrontDoor {
  return new FrontDoor(app.lookup);
}
