import type { DatabaseSync } from "node:sqlite";
import { Approval, type ApprovalKind, type ApprovalStatus } from "../../domain/approval.js";
import type { IApprovalStore } from "../../ports/stores.js";

type Row = Record<string, unknown>;

export class SqliteApprovalStore implements IApprovalStore {
  constructor(private readonly db: DatabaseSync) {}

  save(approval: Approval): void {
    const p = approval.toProps();
    this.db
      .prepare(`INSERT INTO approvals (id, kind, target, reason, status, requested_at, decided_by, decided_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET status = excluded.status, decided_by = excluded.decided_by,
                  decided_at = excluded.decided_at`)
      .run(p.id, p.kind, p.target, p.reason, p.status, p.requestedAt, p.decidedBy ?? null, p.decidedAt ?? null);
  }

  get(id: string): Approval | undefined {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return row ? this.toApproval(row) : undefined;
  }

  pending(): Approval[] {
    const rows = this.db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY requested_at").all() as Row[];
    return rows.map((r) => this.toApproval(r));
  }

  open(): Approval[] {
    const rows = this.db
      .prepare("SELECT * FROM approvals WHERE status IN ('pending', 'approved') ORDER BY requested_at").all() as Row[];
    return rows.map((r) => this.toApproval(r));
  }

  private toApproval(r: Row): Approval {
    return Approval.restore({
      id: String(r.id),
      kind: r.kind as ApprovalKind,
      target: String(r.target),
      reason: String(r.reason),
      status: r.status as ApprovalStatus,
      requestedAt: String(r.requested_at),
      ...(r.decided_by ? { decidedBy: String(r.decided_by) } : {}),
      ...(r.decided_at ? { decidedAt: String(r.decided_at) } : {}),
    });
  }
}
