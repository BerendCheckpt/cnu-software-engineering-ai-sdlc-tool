import type { Finding } from "../cleanup/Finding.js";

/** One check of a task. It failed when a blocking issue was open or something else got worse. */
export interface FixAttempt {
  at: string;
  blocking: Finding[];
  reported: Finding[];
  /** Everything else that failed: a gate, a regression. */
  problems: string[];
  /** Files the change touched at this check, so a later try can see what was already tried. */
  changed?: string[];
}
