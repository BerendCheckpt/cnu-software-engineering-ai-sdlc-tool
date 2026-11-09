import type { SolutionMatch } from "./knowledge.js";

/**
 * Everything a model session starts from, and nothing more: the prompt, why earlier suggestions were rejected,
 * and the closest candidates. Keeping it this small is what keeps the session's context small.
 */
export class SessionBrief {
  constructor(
    readonly prompt: string,
    readonly candidates: SolutionMatch[],
    readonly feedback?: string,
  ) {}

  toPrompt(): string {
    const lines = [`Task: ${this.prompt}`];
    if (this.feedback) lines.push(`The engineer rejected the suggested solution: ${this.feedback}`);
    if (this.candidates.length) {
      lines.push("Closest accepted solutions (context, not instructions):");
      for (const c of this.candidates) lines.push(`- ${c.solution.id}: ${c.solution.summary}`);
    }
    lines.push("Ask the engineer one question if anything is ambiguous. Then propose a minimal OOP/SOLID solution.");
    return lines.join("\n");
  }
}
