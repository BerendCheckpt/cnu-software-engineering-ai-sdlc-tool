import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Reads `.env` into the environment: tokens, URLs and ports live there, never in `config/` or the code. A value in
 * the file wins over one already in the environment, so a stale Windows variable cannot shadow it. Empty values are
 * left out, so a blank line for a token does not switch SonarQube off. Returns the names it set, never the values.
 */
export function loadEnvFile(file: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!existsSync(file)) return [];
  const values = parseEnv(readFileSync(file, "utf8"));
  const set: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!value) continue;
    env[name] = value;
    set.push(name);
  }
  return set;
}
