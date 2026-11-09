import type { DatabaseSync } from "node:sqlite";
import type { DocChunk, DocSource } from "../../domain/docs.js";
import type { IDocStore } from "../../ports/stores.js";
import { ftsAnyOf } from "./database.js";

type Row = Record<string, unknown>;

export class SqliteDocStore implements IDocStore {
  constructor(private readonly db: DatabaseSync) {}

  replaceChunks(source: DocSource, chunks: DocChunk[], fetchedAt = new Date().toISOString()): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM doc_chunks WHERE source_id = ?").run(source.id);
      const insert = this.db.prepare(
        "INSERT INTO doc_chunks (source_id, framework, version, heading, content, url) VALUES (?, ?, ?, ?, ?, ?)");
      for (const c of chunks) insert.run(source.id, source.framework, source.version, c.heading, c.content, c.url);
      this.db
        .prepare(`INSERT INTO doc_sources (id, framework, version, url, fetched_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at`)
        .run(source.id, source.framework, source.version, source.url, fetchedAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  hasSource(sourceId: string): boolean {
    return this.db.prepare("SELECT 1 FROM doc_sources WHERE id = ?").get(sourceId) !== undefined;
  }

  search(terms: string[], limit: number, framework?: string, version?: string): DocChunk[] {
    const query = ftsAnyOf(terms);
    if (!query) return [];
    const rows = this.db
      .prepare(`SELECT source_id, heading, content, url FROM doc_chunks
                WHERE doc_chunks MATCH ? AND (? IS NULL OR framework = ?) AND (? IS NULL OR version = ?)
                ORDER BY bm25(doc_chunks, 0, 0, 0, 5.0, 1.0) LIMIT ?`)
      .all(query, framework ?? null, framework ?? null, version ?? null, version ?? null, limit) as Row[];
    return rows.map((r) => this.toChunk(r));
  }

  chunksOf(sourceId: string): DocChunk[] {
    const rows = this.db
      .prepare("SELECT source_id, heading, content, url FROM doc_chunks WHERE source_id = ? ORDER BY rowid")
      .all(sourceId) as Row[];
    return rows.map((r) => this.toChunk(r));
  }

  private toChunk(r: Row): DocChunk {
    return { sourceId: String(r.source_id), heading: String(r.heading), content: String(r.content), url: String(r.url) };
  }
}
