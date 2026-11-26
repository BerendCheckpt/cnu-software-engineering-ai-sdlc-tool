import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Approval } from "../../../domain/classes/approval/Approval.js";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { IApprovalStore } from "../../../ports/interfaces/approval/IApprovalStore.js";
import type { ISolutionStore } from "../../../ports/interfaces/solution/ISolutionStore.js";
import { hash } from "../../helpers/migration/hash.js";
import { CrystallizeFolders } from "./CrystallizeFolders.js";

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
