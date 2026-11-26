import { DomainError } from "../../classes/errors/DomainError.js";
import { CLEANUP_LEVELS } from "../../constants/cleanup/CLEANUP_LEVELS.js";
import type { CleanupLevel } from "../../types/cleanup/CleanupLevel.js";

export function parseCleanupLevel(value: string | undefined): CleanupLevel {
  const level = (value ?? "verbose").trim().toLowerCase();
  if (!(CLEANUP_LEVELS as readonly string[]).includes(level)) {
    throw new DomainError(`Unknown severity level ${value}. Use one of: ${CLEANUP_LEVELS.join(", ")}.`);
  }
  return level as CleanupLevel;
}
