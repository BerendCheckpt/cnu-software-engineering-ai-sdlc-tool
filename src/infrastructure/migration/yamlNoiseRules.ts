import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { NO_NOISE_RULES, type NoiseRules } from "../../domain/migration.js";

const Words = z.array(z.string().min(1)).default([]);

const Rules = z.object({
  commonTerms: Words,
  boilerplateHeadings: Words,
  areas: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)).default({}),
});

/** Reads `config/noise.yaml`. Without the file nothing is left out, so an older home keeps working. */
export function loadNoiseRules(file: string): NoiseRules {
  if (!existsSync(file)) return NO_NOISE_RULES;
  return Rules.parse(parse(readFileSync(file, "utf8")) ?? {});
}
