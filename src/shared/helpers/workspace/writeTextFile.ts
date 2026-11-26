import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Writes UTF-8 text to `file`, creating its folder first; an existing file is replaced. */
export function writeTextFile(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}
