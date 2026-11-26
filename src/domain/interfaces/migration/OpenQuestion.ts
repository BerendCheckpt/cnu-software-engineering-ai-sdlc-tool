import type { QuestionStatus } from "../../types/migration/QuestionStatus.js";

/** One question a human has to answer before a migration can go on. */
export interface OpenQuestion {
  /** `Q1`, `Q2`, ... */
  id: string;
  status: QuestionStatus;
  /** The finding, not the question: what is known and what is still open. */
  topic: string;
  /** The status cell as written, when it was not one of the four status words and had to be mapped. */
  rawStatus?: string;
}
