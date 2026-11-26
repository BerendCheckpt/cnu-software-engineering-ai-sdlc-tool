import type { MigrationPath } from "../../../domain/interfaces/migration/MigrationPath.js";
import type { MigrationSkill } from "../../../domain/interfaces/migration/MigrationSkill.js";

export interface IMigrationCatalog {
  findSkill(from: string, to: string): MigrationSkill | undefined;
  findPath(from: string, to: string): MigrationPath | undefined;
}
