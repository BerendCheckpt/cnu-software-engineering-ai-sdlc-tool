import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { ID } from "../../constants/migration/ID.js";

export function pair(from: string, to: string): string {
  if (!ID.test(from) || !ID.test(to)) throw new DomainError(`Not a valid migration id: ${from} or ${to}`);
  return `${from}-to-${to}`;
}
