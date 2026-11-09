import type { DatabaseSync } from "node:sqlite";
import { CleanupBatch, CleanupRun, type BatchProps, type RunProps } from "../../domain/cleanup.js";
import type { ICleanupStore } from "../../ports/stores.js";

type Row = Record<string, unknown>;

/** Runs and batches as JSON documents; the state columns are only there to read them at a glance. */
export class SqliteCleanupStore implements ICleanupStore {
  constructor(private readonly db: DatabaseSync) {}

  saveRun(run: CleanupRun): void {
    this.db
      .prepare(`INSERT INTO cleanup_runs (id, state, data) VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET state = excluded.state, data = excluded.data`)
      .run(run.id, run.state, JSON.stringify(run.toProps()));
  }

  run(id: string): CleanupRun | undefined {
    const row = this.db.prepare("SELECT data FROM cleanup_runs WHERE id = ?").get(id) as Row | undefined;
    return row ? CleanupRun.restore(JSON.parse(String(row.data)) as RunProps) : undefined;
  }

  saveBatch(batch: CleanupBatch): void {
    this.db
      .prepare(`INSERT INTO cleanup_batches (run_id, number, status, data) VALUES (?, ?, ?, ?)
                ON CONFLICT(run_id, number) DO UPDATE SET status = excluded.status, data = excluded.data`)
      .run(batch.runId, batch.number, batch.status, JSON.stringify(batch.toProps()));
  }

  batches(runId: string): CleanupBatch[] {
    const rows = this.db.prepare("SELECT data FROM cleanup_batches WHERE run_id = ? ORDER BY number").all(runId) as Row[];
    return rows.map((r) => CleanupBatch.restore(JSON.parse(String(r.data)) as BatchProps));
  }
}
