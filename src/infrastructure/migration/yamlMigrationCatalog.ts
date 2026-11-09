import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { MigrationPath, MigrationSkill } from "../../domain/migration.js";
import type { IMigrationCatalog } from "../../ports/services.js";

const ID = /^[a-z0-9.-]+$/;

const Catalog = z.object({
  migrations: z.array(z.object({
    from: z.string().regex(ID),
    to: z.string().regex(ID),
    sourceDocs: z.array(z.string()).min(1),
    targetDocs: z.array(z.string()).min(1),
    tool: z.string().optional(),
  })),
});

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
    return this.paths.find((p) => p.from === from && p.to === to);
  }
}
