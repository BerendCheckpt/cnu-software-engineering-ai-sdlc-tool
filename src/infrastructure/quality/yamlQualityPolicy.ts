import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { QualityPolicy } from "../../domain/quality.js";

const Severities = z.array(z.string().min(1));

const Sonar = z.object({
  blockingSeverities: Severities.default(["BLOCKER", "HIGH"]),
  reportedSeverities: Severities.default(["MEDIUM"]),
  maxFixAttempts: z.number().int().min(0).default(3),
});

/** Reads `config/quality.yaml`. Without the file the defaults apply: BLOCKER and HIGH block, three fix attempts. */
export function loadQualityPolicy(file: string): QualityPolicy {
  const raw = (existsSync(file) ? parse(readFileSync(file, "utf8")) : undefined) as { sonar?: unknown } | null | undefined;
  const sonar = Sonar.parse(raw?.sonar ?? {});
  return new QualityPolicy(sonar.blockingSeverities, sonar.reportedSeverities, sonar.maxFixAttempts);
}
