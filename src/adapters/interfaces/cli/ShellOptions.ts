export interface ShellOptions {
  /** True for a real terminal: line editing, history keys and tab completion. */
  terminal: boolean;
  historyFile?: string;
  /** The folder the session was started in; a command that needs a repository and names none uses its repository. */
  cwd?: string;
  /** Every command of this shell reports its steps to this session, for example the Claude Code session's name. */
  session?: string;
}
