import type { FindingCategory } from "../../types/cleanup/FindingCategory.js";

/** One problem a tool reported. It never carries a secret's value, only where it is and which rule found it. */
export interface Finding {
  source: string;
  rule: string;
  category: FindingCategory;
  severity: string;
  file: string;
  line?: number;
  message: string;
}
