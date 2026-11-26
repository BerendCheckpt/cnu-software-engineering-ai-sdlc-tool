import { readFileSync } from "node:fs";
import { PathGuard } from "../../../domain/classes/security/PathGuard.js";
import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import { numberedLines } from "../../../shared/helpers/text/numberedLines.js";
import type { FindingWithCode } from "../../interfaces/solution/FindingWithCode.js";

/** Lines of context shown around a finding: enough to fix it, few enough to stay cheap. */
const SNIPPET_CONTEXT = 5;

/** Each finding with the numbered lines around it, read from the workspace it was found in. */
export function withCode(workspace: string, findings: Finding[]): FindingWithCode[] {
  const files = new PathGuard(workspace);
  return findings.map((finding) => ({ finding, code: snippet(files, finding) }));
}

function snippet(files: PathGuard, finding: Finding): string {
  if (!finding.line) return "";
  try {
    const lines = readFileSync(files.resolve(finding.file), "utf8").split(/\r?\n/);
    const first = Math.max(1, finding.line - SNIPPET_CONTEXT);
    const last = Math.min(lines.length, finding.line + SNIPPET_CONTEXT);
    return numberedLines(lines, first, last);
  } catch {
    return "";
  }
}
