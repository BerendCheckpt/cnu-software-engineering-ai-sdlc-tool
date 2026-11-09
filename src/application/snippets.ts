import { readFileSync } from "node:fs";
import type { Finding } from "../domain/cleanup.js";
import { PathGuard } from "../domain/pathGuard.js";

/** Lines of context shown around a finding: enough to fix it, few enough to stay cheap. */
const SNIPPET_CONTEXT = 5;

export interface FindingWithCode {
  finding: Finding;
  code: string;
}

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
    return lines.slice(first - 1, last).map((l, i) => `${first + i}: ${l}`).join("\n");
  } catch {
    return "";
  }
}
