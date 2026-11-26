/** What a human needs to pick up a task the model could not finish. Never holds a token or a secret's value. */
export interface EscalationContext {
  /** One line: what the task was. */
  task: string;
  /** More about the task: the request and summary, or the clean-up batch. */
  details: string[];
  repository: string;
  remoteUrl?: string;
  /** Branch, commit and workspace, as far as they are known. */
  location: string[];
  sonarProjectUrl?: string;
  /** The change of the last attempt. */
  diff: string;
  /** The exact command that repeats the failing check. */
  reproduce: string;
  limitations: string[];
}
