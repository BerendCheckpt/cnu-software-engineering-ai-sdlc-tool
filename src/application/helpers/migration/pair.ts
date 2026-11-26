import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { MIGRATION_ID } from "../../../shared/constants/migration/MIGRATION_ID.js";

/** `<from>-to-<to>`, the folder name of a migration skill; ids that are not safe in a path are refused. */
export function pair(from: string, to: string): string {
  if (!MIGRATION_ID.test(from) || !MIGRATION_ID.test(to)) throw new DomainError(`Not a valid migration id: ${from} or ${to}`);
  return `${from}-to-${to}`;
}
