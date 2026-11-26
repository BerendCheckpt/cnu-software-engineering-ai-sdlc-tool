/** A migration path we know how to ground in official documentation. */
export interface MigrationPath {
  from: string;
  to: string;
  /** Doc source ids that document the source side. All must be downloaded. */
  sourceDocs: string[];
  /** Doc source ids that document the target side, including the official migration guide. */
  targetDocs: string[];
  /** An official tool that does part of the work, such as `ng update`. */
  tool?: string;
  /**
   * The agent that does this migration instead of a plan, such as `cnu:shiva`. Only the retailer-plugin pair may
   * name one; its grounding is that agent, so the path needs no official docs.
   */
  agent?: string;
}
