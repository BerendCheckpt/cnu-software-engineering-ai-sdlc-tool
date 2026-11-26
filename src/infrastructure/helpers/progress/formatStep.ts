import type { StepEvent } from "../../../domain/interfaces/progress/StepEvent.js";
import type { StepStatus } from "../../../domain/types/progress/StepStatus.js";

const MARK: Record<StepStatus, string> = { started: "..", done: "ok", failed: "!!", info: "--" };

export function formatStep(e: StepEvent): string {
  const time = new Date(e.at).toTimeString().slice(0, 8);
  return `[${time}] ${MARK[e.status]} ${e.step}${e.detail ? `: ${e.detail}` : ""}`;
}
