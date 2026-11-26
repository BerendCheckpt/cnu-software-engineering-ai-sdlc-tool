import { mkdirSync } from "node:fs";
import path from "node:path";
import type { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import type { GateSnapshot } from "../../../domain/interfaces/cleanup/GateSnapshot.js";
import type { Snapshot } from "../../../domain/interfaces/cleanup/Snapshot.js";
import type { ICleanupGateFactory } from "../../../ports/interfaces/cleanup/ICleanupGateFactory.js";
import type { IDependencyRestorer } from "../../../ports/interfaces/cleanup/IDependencyRestorer.js";
import type { IProgress } from "../../../ports/interfaces/progress/IProgress.js";
import { runGates } from "../../helpers/evaluation/runGates.js";

/** Restores packages, runs every gate in parallel, then collects findings. No model involved. */
export class MeasureWorkspace {
  constructor(
    private readonly restorer: IDependencyRestorer,
    private readonly gates: ICleanupGateFactory,
    private readonly progress: IProgress,
  ) {}

  async execute(runId: string, workspace: string): Promise<Snapshot> {
    mkdirSync(path.join(workspace, ".aisdlc"), { recursive: true });
    this.progress.emit("restore packages", "started");
    await this.restorer.restore(workspace);
    this.progress.emit("restore packages", "done");
    const { evaluators, findingSources } = this.gates.forRun(runId);
    // Findings are read after the gates, because the SonarQube issues come from the scan the gates just ran.
    this.progress.emit("gates", "started", evaluators.map((e) => e.kind).join(", ") || "none");
    const results = await runGates(evaluators, workspace);
    for (const r of results) {
      this.progress.emit(`gate ${r.kind}`, r.isSkipped ? "info" : r.passed ? "done" : "failed", r.isSkipped ? "skipped" : r.digest);
    }
    this.progress.emit("findings", "started", findingSources.map((s) => s.name).join(", ") || "none");
    const findings = await Promise.all(findingSources.map(async (source) => {
      try {
        return await source.collect(workspace);
      } catch (error) {
        // A source that silently returned nothing would make every finding look fixed.
        throw new Error(`${source.name}: ${(error as Error).message}`);
      }
    }));
    const limitations = findingSources.flatMap((s) => s.limitations?.() ?? []);
    this.progress.emit("findings", "done", `${findings.flat().length} open`);
    return { gates: results.map(toGateSnapshot), findings: findings.flat(), ...(limitations.length ? { limitations } : {}) };
  }
}

function toGateSnapshot(r: EvaluationResult): GateSnapshot {
  return {
    kind: r.kind,
    passed: r.passed,
    skipped: r.isSkipped,
    ...(r.metrics.tests ? { tests: r.metrics.tests } : {}),
    ...(r.metrics.coverage !== undefined ? { coverage: r.metrics.coverage } : {}),
  };
}
