import { DomainError } from "./errors.js";

/** Decides which URLs may be fetched or cloned: https only, an allowed host, and no credentials. */
export class UrlPolicy {
  private readonly hosts: Set<string>;

  constructor(allowedHosts: string[]) {
    this.hosts = new Set(allowedHosts.map((h) => h.toLowerCase()));
  }

  check(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new DomainError(`Not a valid URL: ${rawUrl}`);
    }
    if (url.protocol !== "https:") throw new DomainError(`Only https URLs are allowed: ${rawUrl}`);
    if (url.username || url.password) throw new DomainError("A URL must not carry credentials.");
    if (!this.hosts.has(url.hostname.toLowerCase())) {
      throw new DomainError(`Host ${url.hostname} is not on the allow-list in config/sources.yaml.`);
    }
    return url;
  }
}
