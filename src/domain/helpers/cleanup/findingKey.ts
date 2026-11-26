import type { Finding } from "../../interfaces/cleanup/Finding.js";

/**
 * Identifies a finding across runs. The line is left out on purpose: fixing something above it moves it,
 * and a moved finding is not a new one.
 */
export function findingKey(f: Finding): string {
  return [f.source, f.rule, f.file, f.message].join("|");
}
