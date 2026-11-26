import type { Finding } from "../../interfaces/cleanup/Finding.js";

export function isSonar(f: Finding): boolean {
  return f.source.toLowerCase() === "sonar";
}
