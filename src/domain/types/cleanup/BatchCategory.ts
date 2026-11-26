import type { FindingCategory } from "./FindingCategory.js";

// ---------------------------------------------------------------------------------------------------------------

/** `ci`: the checks that failed on the run's pull request; one such batch per run, reopened per failed CI round. */
export type BatchCategory = FindingCategory | "format" | "ci";
