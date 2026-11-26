import type { Finding } from "../../interfaces/cleanup/Finding.js";

/** Security concerns for the PR: security findings, and vulnerable dependencies the audits reported. */
export function isSecurityFinding(f: Finding): boolean {
  return f.category === "security" || f.category === "dependency";
}
