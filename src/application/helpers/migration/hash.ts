import { createHash } from "node:crypto";

export function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
