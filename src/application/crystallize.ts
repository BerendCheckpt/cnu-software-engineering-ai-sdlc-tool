import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Approval } from "../domain/approval.js";
import type { DocSource } from "../domain/docs.js";
import { DomainError } from "../domain/errors.js";
import type { EvaluationResult } from "../domain/evaluation.js";
import type { Application } from "../domain/knowledge.js";
import type { MigrationPath } from "../domain/migration.js";
import { PathGuard } from "../domain/pathGuard.js";
import type { Solution } from "../domain/solution.js";
import type { IMigrationCatalog, ISourceCatalog } from "../ports/services.js";
import type { IApprovalStore, ISolutionStore } from "../ports/stores.js";
import type { RequestApproval } from "./approvals.js";

const ID = /^[a-z0-9.-]+$/;

/** Everything a crystallized migration skill is written from. */
export interface SkillContent {
  path: MigrationPath;
  solution: Solution;
  steps: string;
  docs: DocSource[];
  evaluations: EvaluationResult[];
  applications: Application[];
}

/** Renders a crystallized migration skill from a fixed template. */
export interface ISkillWriter {
  render(content: SkillContent): string;
}

/** Where drafts wait for review, and where approved skills go. */
export class CrystallizeFolders {
  private readonly drafts: PathGuard;
  private readonly skills: PathGuard;

  constructor(workRoot: string, skillsRoot: string) {
    this.drafts = new PathGuard(path.join(workRoot, "crystallize"));
    this.skills = new PathGuard(skillsRoot);
  }

  draft(from: string, to: string): string { return this.drafts.resolve(`${pair(from, to)}.md`); }
  skill(from: string, to: string): string { return path.join(this.skills.resolve(pair(from, to)), "SKILL.md"); }
}

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
    const solution = this.solutions.get(solutionId);
    if (!solution) throw new DomainError(`No solution ${solutionId}.`);
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
    mkdirSync(path.dirname(draftPath), { recursive: true });
    writeFileSync(draftPath, markdown, "utf8");

    const approval = this.requestApproval.execute("crystallize", `${solutionId}:${pair(from, to)}@${hash(markdown)}`,
      `crystallize ${pair(from, to)} from solution ${solutionId}; review ${draftPath}`);
    return { draftPath, approval };
  }
}

/** Writes the approved draft as the skill, once, and marks the solution crystallized. Called only by the CLI. */
export class CrystallizeMigration {
  constructor(
    private readonly folders: CrystallizeFolders,
    private readonly approvals: IApprovalStore,
    private readonly solutions: ISolutionStore,
  ) {}

  execute(approval: Approval): string {
    approval.ensureApprovedFor("crystallize");
    const target = /^([^:]+):([a-z0-9.-]+)-to-([a-z0-9.-]+)@([0-9a-f]{12})$/.exec(approval.target);
    if (!target) throw new DomainError(`Approval ${approval.id} is not for a migration skill.`);
    const [, solutionId, from, to, approvedHash] = target as unknown as [string, string, string, string, string];

    const draft = readFileSync(this.folders.draft(from, to), "utf8");
    if (hash(draft) !== approvedHash) {
      throw new DomainError(`The draft changed after it was reviewed. Run crystallize again; the new text needs its own approval.`);
    }
    const solution = this.solutions.get(solutionId);
    if (!solution) throw new DomainError(`No solution ${solutionId}.`);

    const skillPath = this.folders.skill(from, to);
    mkdirSync(path.dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, draft, { encoding: "utf8", flag: "wx" });
    solution.moveTo("crystallized");
    approval.consume("crystallize");
    this.solutions.save(solution);
    this.approvals.save(approval);
    return skillPath;
  }
}

function pair(from: string, to: string): string {
  if (!ID.test(from) || !ID.test(to)) throw new DomainError(`Not a valid migration id: ${from} or ${to}`);
  return `${from}-to-${to}`;
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function latestPerKind(results: EvaluationResult[]): EvaluationResult[] {
  const latest = new Map<string, EvaluationResult>();
  for (const result of results) latest.set(result.kind, result);
  return [...latest.values()];
}
