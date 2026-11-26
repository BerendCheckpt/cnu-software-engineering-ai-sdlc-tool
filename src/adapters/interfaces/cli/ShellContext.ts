/** What an interactive session remembers between commands, so ids are not typed twice. */
export interface ShellContext {
  repo?: string;
  solution?: string;
  run?: string;
  /** The session every command reports its steps to, when it was named at the start. */
  session?: string;
}
