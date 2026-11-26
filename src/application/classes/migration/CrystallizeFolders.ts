import path from "node:path";
import { PathGuard } from "../../../domain/classes/security/PathGuard.js";
import { pair } from "../../helpers/migration/pair.js";

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
