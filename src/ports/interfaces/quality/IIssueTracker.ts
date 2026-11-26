/** Opens an issue for a human in the working repository; returns its URL, or what the engineer has to do by hand. */
export interface IIssueTracker {
  open(remoteUrl: string | undefined, title: string, bodyFile: string): Promise<string>;
}
