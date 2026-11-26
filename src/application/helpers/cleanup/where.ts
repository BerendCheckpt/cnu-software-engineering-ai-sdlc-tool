import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import { findingLocation } from "../../../shared/helpers/findings/findingLocation.js";

/** A finding in a few words for a message: its rule, then `file:line` when it has a file. */
export function where(f: Finding): string {
  return `${f.rule}${f.file ? ` ${findingLocation(f)}` : ""}`;
}
