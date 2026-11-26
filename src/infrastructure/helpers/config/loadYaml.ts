import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { z } from "zod";

/** Reads a YAML config file and checks it against `schema`; a file that does not match throws with zod's reasons. */
export function loadYaml<S extends z.ZodType>(file: string, schema: S): z.output<S> {
  return schema.parse(parse(readFileSync(file, "utf8")));
}
