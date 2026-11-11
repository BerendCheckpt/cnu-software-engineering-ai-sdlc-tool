import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { FINDING_CATEGORIES, type FindingCategory } from "../../domain/cleanup.js";
import type { BatchLimits } from "../../domain/cleanupPlanner.js";
import type { GatePatterns } from "../../domain/diffClassifier.js";

const Patterns = z.array(z.string().min(1)).default([]);

const Policy = z.object({
  batches: z.object({
    maxFindings: z.number().int().min(1).max(50),
    maxFiles: z.number().int().min(1).max(20),
    maxTries: z.number().int().min(1).max(20).default(5),
    order: z.array(z.enum(FINDING_CATEGORIES)).min(1),
  }),
  gates: z.object({
    testFiles: Patterns,
    dependencyFiles: Patterns,
    securityFiles: Patterns,
    securityContent: Patterns,
  }),
});

export interface CleanupPolicy {
  limits: BatchLimits;
  order: FindingCategory[];
  patterns: GatePatterns;
  /** Checks a batch gets before the engineer decides. */
  maxTries: number;
}

/** Reads `config/cleanup.yaml`. A pattern that is not a valid regular expression stops the load. */
export function loadCleanupPolicy(file: string): CleanupPolicy {
  const policy = Policy.parse(parse(readFileSync(file, "utf8")));
  const compile = (patterns: string[]) => patterns.map((p) => new RegExp(p, "i"));
  return {
    limits: { maxFindings: policy.batches.maxFindings, maxFiles: policy.batches.maxFiles },
    order: policy.batches.order,
    maxTries: policy.batches.maxTries,
    patterns: {
      testFiles: compile(policy.gates.testFiles),
      dependencyFiles: compile(policy.gates.dependencyFiles),
      securityFiles: compile(policy.gates.securityFiles),
      securityContent: compile(policy.gates.securityContent),
    },
  };
}
