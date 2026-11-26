import { isSonar } from "../../helpers/quality/isSonar.js";
import { normalizeSeverity } from "../../helpers/quality/normalizeSeverity.js";
import type { Finding } from "../../interfaces/cleanup/Finding.js";
import type { Severity } from "../../types/quality/Severity.js";
import { DomainError } from "../errors/DomainError.js";

/** Which SonarQube findings stop a task, which are only reported, and how often the model may try again. */
export class QualityPolicy {
  private readonly blockingSet: Set<Severity>;
  private readonly reportedSet: Set<Severity>;

  constructor(blocking: string[], reported: string[], readonly maxFixAttempts: number) {
    if (!Number.isInteger(maxFixAttempts) || maxFixAttempts < 0) {
      throw new DomainError("maxFixAttempts must be a whole number of 0 or more.");
    }
    this.blockingSet = new Set(blocking.map(normalizeSeverity));
    this.reportedSet = new Set(reported.map(normalizeSeverity).filter((s) => !this.blockingSet.has(s)));
  }

  /** Open SonarQube issues the task must fix before it is done. */
  blocking(findings: Finding[]): Finding[] {
    return findings.filter((f) => isSonar(f) && this.blockingSet.has(normalizeSeverity(f.severity)));
  }

  /** Open SonarQube issues the model is asked to fix, but that never fail a check. */
  reported(findings: Finding[]): Finding[] {
    return findings.filter((f) => isSonar(f) && this.reportedSet.has(normalizeSeverity(f.severity)));
  }
}
