import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DocSource } from "../../domain/docs.js";
import { PathGuard } from "../../domain/pathGuard.js";
import type { ArchivedPage, IDocArchive } from "../../ports/services.js";

const HEADER = /^<!-- source: .*? \| fetched: (\S+) -->\r?\n\r?\n/;

/** Writes each page once to `<root>/<framework>/<version>/<id>.md` and makes it read-only. */
export class FileDocArchive implements IDocArchive {
  private readonly guard: PathGuard;

  constructor(root: string) {
    this.guard = new PathGuard(root);
  }

  write(source: DocSource, markdown: string): string {
    const file = this.fileOf(source);
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file)) chmodSync(file, 0o644);
    const header = `<!-- source: ${source.url} | fetched: ${new Date().toISOString()} -->\n\n`;
    writeFileSync(file, header + markdown, "utf8");
    chmodSync(file, 0o444);
    return file;
  }

  read(source: DocSource): ArchivedPage | undefined {
    const file = this.fileOf(source);
    if (!existsSync(file)) return undefined;
    const text = readFileSync(file, "utf8");
    const header = HEADER.exec(text);
    // A page without the header is read whole; its fetch time is unknown, so the time of reading stands in.
    return header
      ? { markdown: text.slice(header[0].length), fetchedAt: header[1]! }
      : { markdown: text, fetchedAt: new Date().toISOString() };
  }

  private fileOf(source: DocSource): string {
    return this.guard.resolve(path.join(source.framework, source.version, `${source.id}.md`));
  }
}
