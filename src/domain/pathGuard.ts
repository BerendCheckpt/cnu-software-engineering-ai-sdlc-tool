import path from "node:path";
import { DomainError } from "./errors.js";

/** Keeps every path a tool receives inside one root, whatever `..` or absolute path it was given. */
export class PathGuard {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  resolve(relativePath: string): string {
    const resolved = path.resolve(this.root, relativePath);
    const fromRoot = path.relative(this.root, resolved);
    if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
      throw new DomainError(`Path is outside ${path.basename(this.root)}: ${relativePath}`);
    }
    return resolved;
  }
}
