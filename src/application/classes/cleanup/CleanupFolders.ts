import path from "node:path";
import { PathGuard } from "../../../domain/classes/security/PathGuard.js";

/** Where one run keeps its files: `work/cleanup/<runId>/` with the checkout in `repo/`. */
export class CleanupFolders {
  private readonly root: PathGuard;

  constructor(workRoot: string) {
    this.root = new PathGuard(path.join(workRoot, "cleanup"));
  }

  run(runId: string): string { return this.root.resolve(runId); }
  workspace(runId: string): string { return path.join(this.run(runId), "repo"); }
  plan(runId: string): string { return path.join(this.run(runId), "plan.md"); }
  report(runId: string): string { return path.join(this.run(runId), "report.md"); }
}
