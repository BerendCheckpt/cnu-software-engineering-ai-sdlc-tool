/** One heading section of a downloaded page. */
export interface DocChunk {
  sourceId: string;
  heading: string;
  content: string;
  url: string;
}
