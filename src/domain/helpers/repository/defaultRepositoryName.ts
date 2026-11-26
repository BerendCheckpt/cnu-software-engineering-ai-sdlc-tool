import path from "node:path";
import { DomainError } from "../../classes/errors/DomainError.js";

/** The name a folder gets by default: its own name, with anything not allowed in a name replaced. */
export function defaultRepositoryName(folder: string): string {
  const name = path.basename(path.resolve(folder)).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "");
  if (!name) throw new DomainError(`Cannot name ${folder}; give it a name with --name.`);
  return name;
}
