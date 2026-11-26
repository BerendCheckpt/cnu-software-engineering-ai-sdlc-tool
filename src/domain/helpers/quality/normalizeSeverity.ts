import { SEVERITIES } from "../../constants/quality/SEVERITIES.js";
import type { Severity } from "../../types/quality/Severity.js";

/** Older SonarQube severities, gitleaks' CRITICAL and npm audit's MODERATE, mapped to impact severities. */
const LEGACY: Record<string, Severity> = { CRITICAL: "HIGH", MAJOR: "MEDIUM", MODERATE: "MEDIUM", MINOR: "LOW" };

/** Maps any severity a tool reports, old or new, to an impact severity. Unknown values count as INFO. */
export function normalizeSeverity(severity: string): Severity {
  const upper = severity.trim().toUpperCase();
  if ((SEVERITIES as readonly string[]).includes(upper)) return upper as Severity;
  return LEGACY[upper] ?? "INFO";
}
