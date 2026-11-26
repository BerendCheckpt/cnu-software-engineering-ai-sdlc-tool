/** Restores packages, the one step that needs the network, so the gates after it can run without. */
export interface IDependencyRestorer {
  restore(workspace: string): Promise<void>;
}
