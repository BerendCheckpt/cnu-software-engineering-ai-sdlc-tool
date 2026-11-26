export interface ReindexResult {
  reindexed: { id: string; chunks: number }[];
  /** Indexed, but its archived page is gone: download it again to change its sections. */
  notArchived: string[];
  failed: { id: string; error: string }[];
}
