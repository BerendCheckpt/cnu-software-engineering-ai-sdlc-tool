import { findingKey } from "../../../domain/helpers/cleanup/findingKey.js";
import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import type { Snapshot } from "../../../domain/interfaces/cleanup/Snapshot.js";

/** The batch's own findings that the measurement still reports. */
export function stillOpen(findings: Finding[], current: Snapshot): Finding[] {
  const open = new Set(current.findings.map(findingKey));
  return findings.filter((f) => open.has(findingKey(f)));
}
