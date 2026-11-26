import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isRetailerPluginPair } from "../../../domain/helpers/migration/isRetailerPluginPair.js";
import type { MigrationPath } from "../../../domain/interfaces/migration/MigrationPath.js";
import type { MigrationSkill } from "../../../domain/interfaces/migration/MigrationSkill.js";
import type { IMigrationCatalog } from "../../../ports/interfaces/migration/IMigrationCatalog.js";
import { MIGRATION_ID } from "../../../shared/constants/migration/MIGRATION_ID.js";
import { loadYaml } from "../../helpers/config/loadYaml.js";

const Path = z.object({
  from: z.string().regex(MIGRATION_ID),
  to: z.string().regex(MIGRATION_ID),
  sourceDocs: z.array(z.string()).default([]),
  targetDocs: z.array(z.string()).default([]),
  tool: z.string().optional(),
  agent: z.string().min(1).optional(),
}).superRefine((p, ctx) => {
  if (p.agent) {
    // Delegating is allowed for retailer plugins only; every other pair stays grounded in official docs.
    if (!isRetailerPluginPair(p.from, p.to)) {
      ctx.addIssue({ code: "custom", message: `Only the retailer-plugin pair may name an agent, not ${p.from} -> ${p.to}.` });
    }
    return;
  }
  if (!p.sourceDocs.length || !p.targetDocs.length) {
    ctx.addIssue({ code: "custom", message: `${p.from} -> ${p.to} needs sourceDocs and targetDocs.` });
  }
});

const Catalog = z.object({ migrations: z.array(Path) });

/** Grounded paths from `config/migrations.yaml`; crystallized skills from `skills/migrations/<from>-to-<to>/`. */
export class YamlMigrationCatalog implements IMigrationCatalog {
  private readonly paths: MigrationPath[];

  constructor(file: string, private readonly skillsRoot: string) {
    this.paths = loadYaml(file, Catalog).migrations;
  }

  findSkill(from: string, to: string): MigrationSkill | undefined {
    if (!MIGRATION_ID.test(from) || !MIGRATION_ID.test(to)) return undefined;
    const skillPath = path.join(this.skillsRoot, `${from}-to-${to}`, "SKILL.md");
    return existsSync(skillPath) ? { from, to, skillPath } : undefined;
  }

  findPath(from: string, to: string): MigrationPath | undefined {
    const [f, t] = [from.toLowerCase(), to.toLowerCase()];
    return this.paths.find((p) => p.from === f && p.to === t);
  }
}
