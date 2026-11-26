/** A tool that fixes formatting by itself, without a model. */
export interface IFormatter {
  readonly name: string;
  /** False when the tool does not apply to this workspace. */
  apply(workspace: string): Promise<boolean>;
}
