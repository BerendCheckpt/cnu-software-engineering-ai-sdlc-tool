import TurndownService from "turndown";
import type { UrlPolicy } from "../../domain/urlPolicy.js";
import type { IDocFetcher } from "../../ports/services.js";

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** Downloads one page and keeps only its main content, as markdown. */
export class HttpDocFetcher implements IDocFetcher {
  private readonly turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

  constructor(private readonly policy: UrlPolicy) {
    // Page chrome and scripts are noise in a model's context.
    this.turndown.remove(["script", "style", "nav", "header", "footer", "aside", "form", "button"]);
  }

  async fetchMarkdown(url: URL): Promise<string> {
    const html = await this.fetchHtml(url);
    if (html.length > MAX_BYTES) throw new Error(`${url} is larger than ${MAX_BYTES} bytes.`);
    return this.turndown.turndown(this.mainContent(html));
  }

  /** Follows redirects by hand, so that every hop must pass the same policy as the approved URL. */
  private async fetchHtml(start: URL): Promise<string> {
    let url = this.policy.check(start.href);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        url = this.policy.check(new URL(location, url).href);
        continue;
      }
      if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
      return response.text();
    }
    throw new Error(`${start} redirected more than ${MAX_REDIRECTS} times.`);
  }

  private mainContent(html: string): string {
    const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html) ?? /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
    return main?.[1] ?? html;
  }
}
