/**
 * What happens to a step: `port` changes the code at its locations, `drop` does not apply to this repository,
 * `question` cannot be decided without a human.
 */
export type StepDecision = "port" | "drop" | "question";
