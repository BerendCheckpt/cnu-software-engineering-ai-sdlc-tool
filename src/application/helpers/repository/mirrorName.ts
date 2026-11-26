import { DomainError } from "../../../domain/classes/errors/DomainError.js";

/** The mirror name is the last path segment of the URL, without `.git`. */
export function mirrorName(url: URL): string {
  const name = url.pathname.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
  if (!name) throw new DomainError(`Cannot name a mirror for ${url.href}.`);
  return name;
}
