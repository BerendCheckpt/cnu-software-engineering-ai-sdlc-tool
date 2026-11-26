import type { Finding } from "../../../domain/interfaces/cleanup/Finding.js";

export function where(f: Finding): string {
  return `${f.rule}${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : ""}`;
}
