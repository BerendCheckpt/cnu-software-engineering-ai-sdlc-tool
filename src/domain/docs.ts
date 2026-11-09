/** One official documentation page from `config/sources.yaml`. */
export interface DocSource {
  id: string;
  framework: string;
  version: string;
  url: string;
}

/** One heading section of a downloaded page. */
export interface DocChunk {
  sourceId: string;
  heading: string;
  content: string;
  url: string;
}
