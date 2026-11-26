import { SEVERITIES } from "../../constants/quality/SEVERITIES.js";
import type { Finding } from "../../interfaces/cleanup/Finding.js";
import type { CleanupLevel } from "../../types/cleanup/CleanupLevel.js";
import type { Severity } from "../../types/quality/Severity.js";
import { isSonar } from "../quality/isSonar.js";
import { normalizeSeverity } from "../quality/normalizeSeverity.js";

const LEVEL_FLOOR: Record<CleanupLevel, Severity> = { verbose: "INFO", medium: "MEDIUM", high: "HIGH" };

/** True when the clean-up must fix this finding at `level`; the others stay in SonarQube and are counted in the PR. */
export function isRequired(f: Finding, level: CleanupLevel): boolean {
  if (!isSonar(f)) return true;
  return SEVERITIES.indexOf(normalizeSeverity(f.severity)) <= SEVERITIES.indexOf(LEVEL_FLOOR[level]);
}
