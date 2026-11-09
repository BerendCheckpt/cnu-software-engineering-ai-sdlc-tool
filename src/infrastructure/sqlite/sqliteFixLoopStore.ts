import type { DatabaseSync } from "node:sqlite";
import { FixLoop, type FixLoopProps } from "../../domain/quality.js";
import type { IFixLoopStore } from "../../ports/stores.js";

/** One row per task; its attempts are kept as JSON, like the clean-up batches. */
export class SqliteFixLoopStore implements IFixLoopStore {
  constructor(private readonly db: DatabaseSync) {}

  save(loop: FixLoop): void {
    const props = loop.toProps();
    this.db
      .prepare(`INSERT INTO fix_loops (subject, state, data) VALUES (?, ?, ?)
                ON CONFLICT(subject) DO UPDATE SET state = excluded.state, data = excluded.data`)
      .run(props.subject, props.state, JSON.stringify(props));
  }

  get(subject: string): FixLoop | undefined {
    const row = this.db.prepare("SELECT data FROM fix_loops WHERE subject = ?").get(subject) as { data: string } | undefined;
    return row ? FixLoop.restore(JSON.parse(row.data) as FixLoopProps) : undefined;
  }
}
