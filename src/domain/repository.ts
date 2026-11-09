import path from "node:path";
import { DomainError } from "./errors.js";

/** The names of mirrors and linked folders: one path segment, no spaces, nothing a shell or git could misread. */
export const REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * A git folder the engineer already pulled, used where a mirror would be. aisdlc only reads it: changes are made in
 * copies under `work/`, so the folder, its branch and its uncommitted files stay as they are.
 */
export interface LinkedRepository {
  name: string;
  path: string;
  linkedAt: string;
}

/** Where a repository comes from: a clone aisdlc made, or a folder the engineer linked. */
export interface RepositoryEntry {
  name: string;
  kind: "mirror" | "linked";
  path: string;
}

/** The name a folder gets by default: its own name, with anything not allowed in a name replaced. */
export function defaultRepositoryName(folder: string): string {
  const name = path.basename(path.resolve(folder)).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "");
  if (!name) throw new DomainError(`Cannot name ${folder}; give it a name with --name.`);
  return name;
}

export function requireRepositoryName(name: string): string {
  if (!REPOSITORY_NAME.test(name)) throw new DomainError(`Not a valid repository name: ${name}`);
  return name;
}

/** The same folder, however it was written. Windows paths are compared without case. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const normal = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return platform === "win32" ? normal(a).toLowerCase() === normal(b).toLowerCase() : normal(a) === normal(b);
}
