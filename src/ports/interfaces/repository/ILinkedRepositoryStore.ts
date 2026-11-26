import type { LinkedRepository } from "../../../domain/interfaces/repository/LinkedRepository.js";

export interface ILinkedRepositoryStore {
  save(repository: LinkedRepository): void;
  get(name: string): LinkedRepository | undefined;
  all(): LinkedRepository[];
  remove(name: string): boolean;
}
