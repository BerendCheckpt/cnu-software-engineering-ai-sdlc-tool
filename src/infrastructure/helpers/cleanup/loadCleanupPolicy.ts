import { z } from "zod";
import { FINDING_CATEGORIES } from "../../../domain/constants/cleanup/FINDING_CATEGORIES.js";
import type { CleanupPolicy } from "../../interfaces/cleanup/CleanupPolicy.js";
import { loadYaml } from "../config/loadYaml.js";

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

/** Reads `config/cleanup.yaml`. A pattern that is not a valid regular expression stops the load. */
export function loadCleanupPolicy(file: string): CleanupPolicy {
  const policy = loadYaml(file, Policy);
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
