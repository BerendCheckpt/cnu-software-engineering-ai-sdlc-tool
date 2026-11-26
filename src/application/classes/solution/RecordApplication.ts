import type { Application } from "../../../domain/interfaces/knowledge/Application.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { requireSolution } from "../../helpers/solution/requireSolution.js";

/** Records where a solution has been applied, so later suggestions can show it. */
export class RecordApplication {
  constructor(private readonly store: ISolutionStore) {}

  execute(application: Application): void {
    requireSolution(this.store, application.solutionId);
    this.store.saveApplication(application);
  }
}
