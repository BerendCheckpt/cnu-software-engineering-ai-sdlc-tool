import { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { ICleanupStore } from "../../../ports/interfaces/cleanup/ICleanupStore.js";

export function requireRun(store: ICleanupStore, id: string): CleanupRun {
  const run = store.run(id);
  if (!run) throw new DomainError(`No clean-up ${id}.`);
  return run;
}
