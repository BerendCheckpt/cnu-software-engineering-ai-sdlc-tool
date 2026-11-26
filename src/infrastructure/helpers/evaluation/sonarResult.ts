import { EvaluationResult } from "../../../domain/classes/evaluation/EvaluationResult.js";
import { SonarClient } from "../../classes/evaluation/SonarClient.js";

/** The quality gate and measures of one project, as a gate result. */
export async function sonarResult(client: SonarClient, projectKey: string): Promise<EvaluationResult> {
  const status = await client.qualityGate(projectKey);
  const measures = await client.measures(projectKey);
  const values = [...measures].map(([metric, value]) => `${metric}=${value}`).join(", ");
  const coverage = measures.get("coverage");
  return new EvaluationResult("sonar", status === "OK", `quality gate ${status}; ${values}`,
    `${client.hostUrl}/dashboard?id=${encodeURIComponent(projectKey)}`,
    coverage === undefined ? {} : { coverage: Number(coverage) });
}
