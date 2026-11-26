/** Downloads one page and returns it as markdown. */
export interface IDocFetcher {
  fetchMarkdown(url: URL): Promise<string>;
}
