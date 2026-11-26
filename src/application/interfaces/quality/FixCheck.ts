import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";

/** What one check of a task found. */
export interface FixCheck {
  blocking: Finding[];
  reported: Finding[];
  problems: string[];
  /** Files the change touched, kept so a later try can see what was already tried. */
  changed?: string[];
}
