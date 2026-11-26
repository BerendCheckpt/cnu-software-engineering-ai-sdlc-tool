import { randomBytes } from "node:crypto";

/** A new run id: it names the workspace, the session and the SonarQube project. */
export function newRunId(): string {
  return randomBytes(4).toString("hex");
}
