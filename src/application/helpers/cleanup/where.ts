import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import { findingLocation } from "../../../shared/helpers/findings/findingLocation.js";

export function where(f: Finding): string {
  return `${f.rule}${f.file ? ` ${findingLocation(f)}` : ""}`;
}
