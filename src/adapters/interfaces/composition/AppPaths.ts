export interface AppPaths {
  home: string;
  database: string;
  docs: string;
  mirrors: string;
  work: string;
  sources: string;
  migrations: string;
  migrationSkills: string;
  cleanupPolicy: string;
  noise: string;
  quality: string;
  runners: string;
  /** The interactive session's command history. */
  history: string;
  /** One `<session>.jsonl` of step events per session, for listeners such as `aisdlc watch`. */
  sessions: string;
}
