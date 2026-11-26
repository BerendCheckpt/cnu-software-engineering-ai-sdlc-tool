import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { Application } from "../../../domain/interfaces/knowledge/Application.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";

/** Records where a solution has been applied, so later suggestions can show it. */
export class RecordApplication {
  constructor(private readonly store: ISolutionStore) {}

  execute(application: Application): void {
    if (!this.store.get(application.solutionId)) throw new DomainError(`No solution ${application.solutionId}.`);
    this.store.saveApplication(application);
  }
}
