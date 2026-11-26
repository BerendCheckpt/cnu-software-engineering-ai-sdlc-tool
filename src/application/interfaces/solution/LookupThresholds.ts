export interface LookupThresholds {
  minimumOverlap: number;
  /** How far the best match must lead the runner-up, as a fraction of the runner-up's relevance. */
  minimumLead: number;
  candidates: number;
}
