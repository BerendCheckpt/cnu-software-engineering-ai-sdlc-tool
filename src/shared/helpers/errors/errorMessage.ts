/** The message of anything that was thrown; a value that is not an Error is shown as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
