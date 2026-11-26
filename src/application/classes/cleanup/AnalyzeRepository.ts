import { writeFileSync } from "node:fs";
import type { CleanupPlanner } from "../../../domain/classes/cleanup/CleanupPlanner.js";
import { CleanupRun } from "../../../domain/classes/cleanup/CleanupRun.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import { isRequired } from "../../../domain/helpers/cleanup/isRequired.js";
import { timeStamp } from "../../../domain/helpers/progress/timeStamp.js";
import type { CleanupLevel } from "../../../domain/types/cleanup/CleanupLevel.js";
import type { ICleanupReportWriter } from "../../../ports/interfaces/cleanup/ICleanupReportWriter.js";
import type { ICleanupStore } from "../../../ports/interfaces/cleanup/ICleanupStore.js";
import type { IGitWorkspace } from "../../../ports/interfaces/git/IGitWorkspace.js";
import type { ISandbox } from "../../../ports/interfaces/process/ISandbox.js";
import type { IProgress } from "../../../ports/interfaces/progress/IProgress.js";
import type { IRepoMirror } from "../../../ports/interfaces/repository/IRepoMirror.js";
import { newRunId } from "../../helpers/cleanup/newRunId.js";
import type { AnalysisResult } from "../../interfaces/cleanup/AnalysisResult.js";
import { CleanupFolders } from "./CleanupFolders.js";
import { MeasureWorkspace } from "./MeasureWorkspace.js";

/**
 * Copies a mirror into a workspace on the run's one branch, `cleanup/DD-MM-YYYY-HHmmss`, measures it and writes the plan.
 * The plan starts right away (automode): the pull request is where a human reviews the result.
 */
export class AnalyzeRepository {
  constructor(
    private readonly folders: CleanupFolders,
    private readonly store: ICleanupStore,
    private readonly mirror: IRepoMirror,
    private readonly git: IGitWorkspace,
    private readonly sandbox: ISandbox,
    private readonly measure: MeasureWorkspace,
    private readonly planner: CleanupPlanner,
    private readonly writer: ICleanupReportWriter,
    private readonly progress: IProgress,
  ) {}

  /** `level` picks the SonarQube severities to fix; findings below it are not planned. */
  async execute(repository: string, id = newRunId(), now = new Date(), level: CleanupLevel = "verbose"): Promise<AnalysisResult> {
    if (!this.mirror.exists(repository)) {
      throw new DomainError(`No mirror or linked folder ${repository}. Link a folder you pulled with: repo link <folder>, ` +
        "or request a clone with: repo add <https-url>");
    }
    const branch = `cleanup/${timeStamp(now)}`;
    const earlier = this.store.runOnBranch(repository, branch);
    if (earlier) {
      throw new DomainError(`Clean-up ${earlier.id} already ran on ${repository} as branch ${branch}: ` +
        "a clean-up or migration already took place on this data.");
    }
    await this.sandbox.ensureAvailable();

    this.progress.emit("checkout", "started", repository);
    const workspace = this.folders.workspace(id);
    await this.mirror.checkout(repository, workspace);
    const { baseBranch, note } = await this.git.prepare(workspace, branch);
    this.progress.emit("checkout", "done", `${branch} from ${baseBranch}`);
    if (note) this.progress.emit("checkout", "info", note);
    const measured = await this.measure.execute(id, workspace);
    const baseline = note ? { ...measured, limitations: [...measured.limitations ?? [], note] } : measured;

    const run = CleanupRun.start({ id, repository, workspace, branch, baseBranch, baseline, level });
    run.moveTo("accepted");
    const batches = this.planner.plan(id, baseline.findings.filter((f) => isRequired(f, level)));
    this.store.saveRun(run);
    for (const batch of batches) this.store.saveBatch(batch);
    const planPath = this.folders.plan(id);
    writeFileSync(planPath, this.writer.plan(run, batches), "utf8");
    this.progress.emit("plan", "done", `${batches.length} batches, ${baseline.findings.length} findings`);
    return { run, batches, planPath };
  }
}
