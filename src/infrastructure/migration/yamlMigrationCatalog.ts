import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { isRetailerPluginPair, type MigrationPath, type MigrationSkill } from "../../domain/migration.js";
import type { IMigrationCatalog } from "../../ports/services.js";

const ID = /^[a-z0-9.-]+$/;

const Path = z.object({
  from: z.string().regex(ID),
  to: z.string().regex(ID),
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
    this.paths = Catalog.parse(parse(readFileSync(file, "utf8"))).migrations;
  }

  findSkill(from: string, to: string): MigrationSkill | undefined {
    if (!ID.test(from) || !ID.test(to)) return undefined;
    const skillPath = path.join(this.skillsRoot, `${from}-to-${to}`, "SKILL.md");
    return existsSync(skillPath) ? { from, to, skillPath } : undefined;
  }

  findPath(from: string, to: string): MigrationPath | undefined {
    const [f, t] = [from.toLowerCase(), to.toLowerCase()];
    return this.paths.find((p) => p.from === f && p.to === t);
  }
}
