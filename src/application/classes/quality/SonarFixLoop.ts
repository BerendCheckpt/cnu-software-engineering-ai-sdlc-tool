import path from "node:path";
import { FixLoop } from "../../../domain/classes/quality/FixLoop.js";
import type { QualityPolicy } from "../../../domain/classes/quality/QualityPolicy.js";
import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import type { EscalationContext } from "../../../ports/interfaces/quality/EscalationContext.js";
import type { IEscalationWriter } from "../../../ports/interfaces/quality/IEscalationWriter.js";
import type { IFixLoopStore } from "../../../ports/interfaces/quality/IFixLoopStore.js";
import type { IIssueTracker } from "../../../ports/interfaces/quality/IIssueTracker.js";
import { errorMessage } from "../../../shared/helpers/errors/errorMessage.js";
import { slugify } from "../../../shared/helpers/text/slugify.js";
import { writeTextFile } from "../../../shared/helpers/workspace/writeTextFile.js";
import type { BatchLoopOutcome } from "../../types/quality/BatchLoopOutcome.js";
import type { FixCheck } from "../../types/quality/FixCheck.js";
import type { LoopOutcome } from "../../types/quality/LoopOutcome.js";

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

  /**
   * Records one check of a clean-up batch. A batch gets `maxTries` checks; when the last one fails, it waits for the
   * engineer instead of opening an issue by itself. The engineer retries it (`reopen`) or escalates it (`openIssues`).
   */
  checkBatch(subject: string, check: FixCheck, maxTries: number): BatchLoopOutcome {
    const loop = this.store.get(subject) ?? FixLoop.start(subject);
    const verdict = loop.record({ at: new Date().toISOString(), ...check }, this.policy, maxTries - 1);
    if (verdict.kind === "escalate") loop.escalated("waiting for the engineer");
    this.store.save(loop);
    if (verdict.kind === "clean") return verdict;
    return verdict.kind === "escalate"
      ? { kind: "engineer", tries: verdict.failures, maxTries }
      : { kind: "fix-required", tries: verdict.failures, maxTries };
  }

  /**
   * Opens one issue per finding the engineer chose to leave open. Each issue's text is written to a file first, and
   * each failed issue is logged on its own, so one failure never stops the others.
   */
  async openIssues(subject: string, findings: Finding[], context: () => Promise<EscalationContext>): Promise<string[]> {
    const loop = this.store.get(subject) ?? FixLoop.start(subject);
    let details: EscalationContext;
    try {
      details = await context();
    } catch (error) {
      const message = `Issues for ${subject} could not be prepared: ${errorMessage(error)}`;
      this.log(message);
      return [message];
    }
    const base = slugify(subject);
    const opened: string[] = [];
    for (const [i, finding] of findings.entries()) {
      const file = path.join(this.folder, `${base}-${i + 1}.md`);
      try {
        const { title, body } = this.writer.renderFinding(details, finding, loop);
        writeTextFile(file, body);
        opened.push(await this.tracker.open(details.remoteUrl, title, file));
      } catch (error) {
        const message = `Issue for ${finding.rule} ${finding.file} could not be opened: ${errorMessage(error)}`;
        this.log(message);
        opened.push(`${message}. Look at ${file}`);
      }
    }
    return opened;
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
    const file = path.join(this.folder, `${slugify(loop.subject)}.md`);
    try {
      const details = await context();
      const { title, body } = this.writer.render(details, loop, this.policy.maxFixAttempts);
      writeTextFile(file, body);
      return await this.tracker.open(details.remoteUrl, title, file);
    } catch (error) {
      const message = `Escalation of ${loop.subject} could not be opened: ${errorMessage(error)}`;
      this.log(message);
      return `${message}. Look at ${file} and the work folder.`;
    }
  }
}
