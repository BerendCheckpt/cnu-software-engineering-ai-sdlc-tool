import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Finding } from "../domain/cleanup.js";
import { FixLoop, type QualityPolicy } from "../domain/quality.js";
import type { EscalationContext, IEscalationWriter, IIssueTracker } from "../ports/services.js";
import type { IFixLoopStore } from "../ports/stores.js";

/** What one check of a task found. */
export interface FixCheck {
  blocking: Finding[];
  reported: Finding[];
  problems: string[];
}

export type LoopOutcome =
  | { kind: "clean" }
  | { kind: "fix-required"; failures: number; maxFixAttempts: number }
  | { kind: "escalated"; failures: number; where: string };

/**
 * Counts the checks of a task and hands it to a human when the model failed too often (ADR 0010). Used by a
 * solution's `eval` and a clean-up batch's `check`. The model cannot reset the count; only `reopen` by a human does.
 */
export class SonarFixLoop {
  constructor(
    private readonly store: IFixLoopStore,
    readonly policy: QualityPolicy,
    private readonly writer: IEscalationWriter,
    private readonly tracker: IIssueTracker,
    private readonly folder: string,
    private readonly log: (message: string) => void = (m) => console.error(m),
  ) {}

  /** Splits a measurement's findings into what blocks and what is only reported. */
  split(findings: Finding[]): { blocking: Finding[]; reported: Finding[] } {
    return { blocking: this.policy.blocking(findings), reported: this.policy.reported(findings) };
  }

  current(subject: string): FixLoop | undefined {
    return this.store.get(subject);
  }

  /** Records one check. `context` is only built when the task is escalated. */
  async check(subject: string, check: FixCheck, context: () => Promise<EscalationContext>): Promise<LoopOutcome> {
    const loop = this.store.get(subject) ?? FixLoop.start(subject);
    const verdict = loop.record({ at: new Date().toISOString(), ...check }, this.policy);
    if (verdict.kind !== "escalate") {
      this.store.save(loop);
      return verdict;
    }
    // Saved before anything leaves the machine, so a crash cannot give the model another try.
    loop.escalated("escalating");
    this.store.save(loop);
    const where = await this.escalate(loop, context);
    loop.escalated(where);
    this.store.save(loop);
    return { kind: "escalated", failures: verdict.failures, where };
  }

  /** A human hands an escalated task back. */
  reopen(subject: string): FixLoop {
    const loop = this.store.get(subject);
    if (!loop) throw new Error(`Nothing was checked for ${subject}.`);
    loop.reopen();
    this.store.save(loop);
    return loop;
  }

  /** The issue text is always written to a file first; a failure to open the issue is logged and never stalls. */
  private async escalate(loop: FixLoop, context: () => Promise<EscalationContext>): Promise<string> {
    const file = path.join(this.folder, `${loop.subject.replace(/[^A-Za-z0-9._-]+/g, "-")}.md`);
    try {
      const details = await context();
      const { title, body } = this.writer.render(details, loop, this.policy.maxFixAttempts);
      mkdirSync(this.folder, { recursive: true });
      writeFileSync(file, body, "utf8");
      return await this.tracker.open(details.remoteUrl, title, file);
    } catch (error) {
      const message = `Escalation of ${loop.subject} could not be opened: ${(error as Error).message}`;
      this.log(message);
      return `${message}. Look at ${file} and the work folder.`;
    }
  }
}
