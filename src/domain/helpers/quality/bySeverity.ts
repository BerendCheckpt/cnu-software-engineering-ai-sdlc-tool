import { SEVERITIES } from "../../constants/quality/SEVERITIES.js";
import { normalizeSeverity } from "./normalizeSeverity.js";

/** Most severe first; findings of equal severity keep their order. */
export function bySeverity<T extends { severity: string }>(items: T[]): T[] {
  const rank = (s: string) => SEVERITIES.indexOf(normalizeSeverity(s));
  return [...items].sort((a, b) => rank(a.severity) - rank(b.severity));
}
