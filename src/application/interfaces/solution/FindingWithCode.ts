import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";

export interface FindingWithCode {
  finding: Finding;
  code: string;
}
