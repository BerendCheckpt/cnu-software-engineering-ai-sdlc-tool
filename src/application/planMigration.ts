import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CodeTermExtractor } from "../domain/codeTermExtractor.js";
import type { DocChunk } from "../domain/docs.js";
import { MarkdownChunker } from "../domain/markdownChunker.js";
import {
  type MigrationOutcome, type MigrationPath, type MigrationStep, NO_NOISE_RULES, type NoiseRules,
} from "../domain/migration.js";
import { PathGuard } from "../domain/pathGuard.js";
import type { IMigrationCatalog, IRepoMirror } from "../ports/services.js";
import type { IDocStore } from "../ports/stores.js";
import type { RequestDocs } from "./docs.js";

const LOCATIONS_PER_STEP = 5;
const COMMON_SHARE = 0.25;
const MIN_COMMON_SECTIONS = 4;
/** A line that starts with a link, such as a row of a breaking-change table: `[Title](relative/page)`. */
const LINKED_ITEM = /^\[([^\]\n]+)\]\(([^)\s]+)\)/gm;

interface Candidate {
  heading: string;
  docUrl: string;
  text: string;
  /** How many different terms a file must contain to count. */
  minTerms: number;
}

/** Whether the repository uses a doc area, from the markers in `config/noise.yaml`; asked once per area. */
class AreaGate {
  private readonly answers = new Map<string, Promise<boolean>>();
  private readonly markers: Map<string, string[]>;

  constructor(areas: Record<string, string[]>, private readonly check: (markers: string[]) => Promise<boolean>) {
    this.markers = new Map(Object.entries(areas).map(([area, markers]) => [area.toLowerCase(), markers]));
  }

  uses(area: string): Promise<boolean> {
    const key = area.toLowerCase();
    const markers = this.markers.get(key);
    // An area without markers is not gated.
    if (!markers) return Promise.resolve(true);
    if (!this.answers.has(key)) this.answers.set(key, this.check(markers));
    return this.answers.get(key)!;
  }
}

export interface MigrationRequest {
  from: string;
  to: string;
  repository: string;
}

/**
 * Makes the initial migration plan, without a model, and stops at the first missing precondition:
 * a crystallized skill wins; an unknown path or missing official docs go back to a human;
 * an unmirrored repository needs its URL from a human.
 */
export class PlanMigration {
  private readonly work: PathGuard;

  constructor(
    workRoot: string,
    private readonly catalog: IMigrationCatalog,
    private readonly docs: IDocStore,
    private readonly requestDocs: RequestDocs,
    private readonly mirror: IRepoMirror,
    private readonly rules: NoiseRules = NO_NOISE_RULES,
    private readonly extractor = new CodeTermExtractor(rules.commonTerms),
  ) {
    this.work = new PathGuard(workRoot);
  }

  async execute(request: MigrationRequest): Promise<MigrationOutcome> {
    const { from, to, repository } = request;
    const skill = this.catalog.findSkill(from, to);
    if (skill) return { kind: "skill", skill };

    const migration = this.catalog.findPath(from, to);
    if (!migration) {
      return { kind: "escalate", reason: `No migration from ${from} to ${to} is grounded in official documentation.` };
    }

    const missing = [...migration.sourceDocs, ...migration.targetDocs].filter((id) => !this.docs.hasSource(id));
    if (missing.length) return this.requestMissingDocs(migration, missing);

    if (!this.mirror.exists(repository)) return { kind: "repo-missing", repository };

    const { steps, tooCommon } = await this.locateSteps(migration, repository);
    const reportPath = this.writePlan(migration, repository, steps, tooCommon);
    return { kind: "plan", path: migration, steps, reportPath };
  }

  private requestMissingDocs(migration: MigrationPath, missing: string[]): MigrationOutcome {
    const reason = `Migration ${migration.from} -> ${migration.to} needs it.`;
    const approvalIds: string[] = [];
    for (const id of missing) {
      const result = this.requestDocs.execute(id, reason);
      // Not in the manifest means no official page is known: do not migrate.
      if (result.kind === "unknown") return { kind: "escalate", reason: `No official documentation source for ${id}.` };
      if (result.kind === "requested") approvalIds.push(result.approval.id);
    }
    return { kind: "docs-missing", missing, approvalIds };
  }

  /**
   * One step per section of the target docs, and per linked item in a section, that names an API the repository
   * uses. Left out: sections that repeat an earlier one word for word, sections of an area the repository does not
   * use, and terms found in so many sections that they are wording rather than an API. A location belongs to the
   * first step that finds it, so later sections that only repeat it add no step.
   */
  private async locateSteps(migration: MigrationPath, repository: string) {
    const chunks = migration.targetDocs.flatMap((id) => this.docs.chunksOf(id));
    const tooCommon = this.tooCommon(chunks);
    const areas = new AreaGate(this.rules.areas, (markers) => this.mirror.uses(repository, markers));
    const seenSections = new Set<string>();
    const listed = new Set<string>();
    const steps: MigrationStep[] = [];
    for (const chunk of chunks) {
      const text = chunk.content.toLowerCase().replace(/\s+/g, " ");
      if (seenSections.has(text)) continue;
      seenSections.add(text);
      if (!(await areas.uses(MarkdownChunker.areaOf(chunk.heading)))) continue;

      for (const candidate of this.candidates(chunk)) {
        const terms = this.extractor.extract(candidate.text, tooCommon);
        if (!terms.length) continue;
        const found = await this.mirror.search(repository, terms, LOCATIONS_PER_STEP + listed.size, candidate.minTerms);
        const locations = found.filter((l) => !listed.has(`${l.path}:${l.line}`)).slice(0, LOCATIONS_PER_STEP);
        locations.forEach((l) => listed.add(`${l.path}:${l.line}`));
        if (locations.length) steps.push({ heading: candidate.heading, docUrl: candidate.docUrl, locations });
      }
    }
    return { steps, tooCommon: [...tooCommon].sort() };
  }

  /**
   * A section's own text, and each linked item in it, such as a row of a breaking-change table. An item's terms
   * belong together (`BackgroundService` and its `ExecuteAsync`), so a file must contain two of them to count.
   */
  private candidates(chunk: DocChunk): Candidate[] {
    const items = [...chunk.content.matchAll(LINKED_ITEM)].map((m) => ({
      heading: `${chunk.heading} › ${m[1]!}`,
      docUrl: new URL(m[2]!, chunk.url).href,
      text: m[1]!,
      minTerms: 2,
    }));
    const rest = chunk.content.replace(LINKED_ITEM, "");
    return [{ heading: chunk.heading, docUrl: chunk.url, text: `${chunk.heading}\n${rest}`, minTerms: 1 }, ...items];
  }

  /** Lower-case terms named in at least a quarter of the sections (and at least 4): wording, not an API. */
  private tooCommon(chunks: DocChunk[]): Set<string> {
    const threshold = Math.max(MIN_COMMON_SECTIONS, Math.ceil(chunks.length * COMMON_SHARE));
    const sections = new Map<string, number>();
    for (const chunk of chunks) {
      for (const term of new Set(this.extractor.all(`${chunk.heading}\n${chunk.content}`).map((t) => t.toLowerCase()))) {
        sections.set(term, (sections.get(term) ?? 0) + 1);
      }
    }
    return new Set([...sections].filter(([, count]) => count >= threshold).map(([term]) => term));
  }

  private writePlan(migration: MigrationPath, repository: string, steps: MigrationStep[], tooCommon: string[]): string {
    const file = this.work.resolve(path.join("migrations", `${migration.from}-to-${migration.to}-${repository}.md`));
    const lines = [
      `# Migration plan: ${migration.from} to ${migration.to} for ${repository}`,
      "",
      "Initial plan, generated from the official documentation and a read-only search of the repository.",
      "A human reviews it before any change is made.",
      "",
      ...(migration.tool ? ["## Start with", "", migration.tool, ""] : []),
      "## Affected code",
      "",
      ...(steps.length ? steps.flatMap((s) => [
        `### ${s.heading}`,
        "",
        `Source: ${s.docUrl}`,
        "",
        ...s.locations.map((l) => `- \`${l.path}:${l.line}\` ${l.text}`),
        "",
      ]) : ["No code in the repository matches an API named in the breaking-change documentation.", ""]),
      ...(tooCommon.length ? [
        "## Ignored as too common",
        "",
        "Named in so many sections of these docs that they are wording, not an API. Add them to config/noise.yaml",
        "under commonTerms to leave them out of every plan.",
        "",
        ...tooCommon.map((t) => `- ${t}`),
        "",
      ] : []),
      "## Documentation used",
      "",
      ...[...migration.sourceDocs, ...migration.targetDocs].map((id) => `- ${id}`),
      "",
    ];
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, lines.join("\n"), "utf8");
    return file;
  }
}
