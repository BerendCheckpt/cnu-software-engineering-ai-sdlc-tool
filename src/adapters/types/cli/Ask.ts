/** Asks a person a question at the terminal; undefined when there is no person to ask. */
export type Ask = (question: string) => Promise<string>;
