import type { FixLoop } from "../../../domain/classes/quality/FixLoop.js";
import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";
import type { EscalationContext } from "./EscalationContext.js";

/** Fixed template for an escalation issue. */
export interface IEscalationWriter {
  render(context: EscalationContext, loop: FixLoop, maxFixAttempts: number): { title: string; body: string };
  /** One finding the engineer chose to leave open after the batch's tries, as its own issue. */
  renderFinding(context: EscalationContext, finding: Finding, loop: FixLoop): { title: string; body: string };
}
