import type { OpenQuestion } from "../../interfaces/migration/OpenQuestion.js";

export type QuestionIndexResult =
  | { kind: "index"; questions: OpenQuestion[] }
  /** Not the table format: never read as "nothing open". */
  | { kind: "unrecognised"; reason: string };
