import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { Solution } from "../../../domain/classes/solution/Solution.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";

/** The stored solution, or a DomainError when there is none with this id. */
export function requireSolution(store: ISolutionStore, id: string): Solution {
  const solution = store.get(id);
  if (!solution) throw new DomainError(`No solution ${id}.`);
  return solution;
}
