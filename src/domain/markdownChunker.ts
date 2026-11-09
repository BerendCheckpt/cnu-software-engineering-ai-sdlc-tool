import type { DocChunk, DocSource } from "./docs.js";

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const MAX_CHUNK_LINES = 60;
const AREA_SEPARATOR = " › ";
const CONTINUED = " (continued)";

/**
 * Splits a page into heading sections of at most 60 lines, so that one search hit never costs more than that
 * in a model's context. A `###` section keeps its `##` area in its heading, as `Blazor › Boot configuration`,
 * and boilerplate sections (navigation, policy) are left out.
 */
export class MarkdownChunker {
  private readonly boilerplate: Set<string>;

  constructor(boilerplateHeadings: string[] = []) {
    this.boilerplate = new Set(boilerplateHeadings.map((h) => h.toLowerCase()));
  }

  /** The `##` area a section belongs to: the part of its heading before ` › `. */
  static areaOf(heading: string): string {
    const area = heading.split(AREA_SEPARATOR)[0]!;
    return area.endsWith(CONTINUED) ? area.slice(0, -CONTINUED.length) : area;
  }

  chunk(source: DocSource, markdown: string): DocChunk[] {
    const chunks: DocChunk[] = [];
    let heading = source.id;
    let area: string | undefined;
    let skipped = false;
    let lines: string[] = [];

    const flush = () => {
      const content = lines.join("\n").trim();
      if (content && !skipped) chunks.push(...this.split(source, heading, content));
      lines = [];
    };

    for (const line of markdown.split(/\r?\n/)) {
      const match = HEADING.exec(line);
      if (match?.[2]) {
        flush();
        const level = match[1]!.length;
        const title = match[2];
        if (level <= 2) area = level === 2 ? title : undefined;
        heading = level === 3 && area ? `${area}${AREA_SEPARATOR}${title}` : title;
        // A `###` under a boilerplate `##` is boilerplate too.
        skipped = this.isBoilerplate(title) || (level === 3 && area !== undefined && this.isBoilerplate(area));
      } else {
        lines.push(line);
      }
    }
    flush();
    return chunks;
  }

  private isBoilerplate(title: string): boolean {
    return this.boilerplate.has(title.toLowerCase());
  }

  private split(source: DocSource, heading: string, content: string): DocChunk[] {
    const lines = content.split("\n");
    const parts: DocChunk[] = [];
    for (let start = 0; start < lines.length; start += MAX_CHUNK_LINES) {
      parts.push({
        sourceId: source.id,
        heading: start === 0 ? heading : `${heading}${CONTINUED}`,
        content: lines.slice(start, start + MAX_CHUNK_LINES).join("\n"),
        url: source.url,
      });
    }
    return parts;
  }
}
