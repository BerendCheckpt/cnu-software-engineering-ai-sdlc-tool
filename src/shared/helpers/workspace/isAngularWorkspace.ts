import { existsSync } from "node:fs";
import path from "node:path";

/** True when the workspace is an Angular project (it has an `angular.json`). */
export function isAngularWorkspace(workspace: string): boolean {
  return existsSync(path.join(workspace, "angular.json"));
}
