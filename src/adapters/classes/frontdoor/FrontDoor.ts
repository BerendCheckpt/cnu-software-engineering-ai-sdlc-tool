import type { LookupSolutions } from "../../../application/classes/solution/LookupSolutions.js";
import { SessionBrief } from "../../../domain/classes/knowledge/SessionBrief.js";
import type { FrontDoorDecision } from "../../types/frontdoor/FrontDoorDecision.js";
import { TextRenderer } from "../render/TextRenderer.js";

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
