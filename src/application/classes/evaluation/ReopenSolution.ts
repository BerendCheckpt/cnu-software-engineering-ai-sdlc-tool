import type { Solution } from "../../../domain/classes/solution/Solution.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { subjectOf } from "../../helpers/evaluation/subjectOf.js";
import { requireSolution } from "../../helpers/solution/requireSolution.js";
import type { SonarFixLoop } from "../quality/SonarFixLoop.js";

/** A human hands an escalated solution back as a draft; its fix attempts count from zero again. */
export class ReopenSolution {
  constructor(private readonly store: ISolutionStore, private readonly fixLoop: SonarFixLoop) {}

  execute(solutionId: string): Solution {
    const solution = requireSolution(this.store, solutionId);
    solution.moveTo("draft");
    this.fixLoop.reopen(subjectOf(solution.id));
    this.store.save(solution);
    return solution;
  }
}
