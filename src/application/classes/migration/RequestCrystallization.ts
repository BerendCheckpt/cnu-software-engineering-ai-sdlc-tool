import { existsSync } from "node:fs";
import type { Approval } from "../../../domain/classes/approval/Approval.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { DocSource } from "../../../domain/interfaces/docs/DocSource.js";
import type { ISourceCatalog } from "../../../ports/interfaces/docs/ISourceCatalog.js";
import type { IMigrationCatalog } from "../../../ports/interfaces/migration/IMigrationCatalog.js";
import type { ISkillWriter } from "../../../ports/interfaces/migration/ISkillWriter.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { latestPerKind } from "../../../shared/helpers/evaluation/latestPerKind.js";
import { writeTextFile } from "../../../shared/helpers/workspace/writeTextFile.js";
import { hash } from "../../helpers/migration/hash.js";
import { pair } from "../../helpers/migration/pair.js";
import { requireSolution } from "../../helpers/solution/requireSolution.js";
import type { RequestApproval } from "../approval/RequestApproval.js";
import { CrystallizeFolders } from "./CrystallizeFolders.js";

/**
 * Turns an accepted, evaluated migration into a draft skill and asks a human to approve exactly that text.
 * The approval's target names the draft's hash, so an edited draft needs a new approval.
 */
export class RequestCrystallization {
  constructor(
    private readonly folders: CrystallizeFolders,
    private readonly solutions: ISolutionStore,
    private readonly migrations: IMigrationCatalog,
    private readonly sources: ISourceCatalog,
    private readonly writer: ISkillWriter,
    private readonly requestApproval: RequestApproval,
  ) {}

  execute(solutionId: string, from: string, to: string, steps: string): { draftPath: string; approval: Approval } {
    const solution = requireSolution(this.solutions, solutionId);
    if (solution.state !== "accepted") throw new DomainError(`Solution ${solutionId} is ${solution.state}; only an accepted one can be crystallized.`);
    const migration = this.migrations.findPath(from, to);
    if (!migration) throw new DomainError(`No migration from ${from} to ${to} in migrations.yaml.`);
    if (existsSync(this.folders.skill(from, to))) throw new DomainError(`A crystallized ${pair(from, to)} skill already exists.`);
    if (!steps.trim()) throw new DomainError("A crystallized migration needs the steps that were needed.");

    const evaluations = latestPerKind(this.solutions.evaluations(solutionId));
    const ran = evaluations.filter((e) => !e.isSkipped);
    if (!ran.length || ran.some((e) => !e.passed)) {
      throw new DomainError(`Solution ${solutionId} has no passing evaluation; run eval first.`);
    }

    const docs = [...migration.sourceDocs, ...migration.targetDocs]
      .map((id) => this.sources.find(id))
      .filter((d): d is DocSource => d !== undefined);
    const markdown = this.writer.render({
      path: migration, solution, steps, docs, evaluations, applications: this.solutions.applications(solutionId),
    });
    const draftPath = this.folders.draft(from, to);
    writeTextFile(draftPath, markdown);

    const approval = this.requestApproval.execute("crystallize", `${solutionId}:${pair(from, to)}@${hash(markdown)}`,
      `crystallize ${pair(from, to)} from solution ${solutionId}; review ${draftPath}`);
    return { draftPath, approval };
  }
}
