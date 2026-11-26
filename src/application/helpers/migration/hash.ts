import { createHash } from "node:crypto";

/** The fingerprint of a skill draft in its approval: the first 12 hex characters of its sha256. */
export function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
