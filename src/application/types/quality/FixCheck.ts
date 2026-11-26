import type { FixAttempt } from "../../../domain/interfaces/quality/FixAttempt.js";

/** What one check of a task found: a fix attempt before it is stamped with the time of the check. */
export type FixCheck = Omit<FixAttempt, "at">;
