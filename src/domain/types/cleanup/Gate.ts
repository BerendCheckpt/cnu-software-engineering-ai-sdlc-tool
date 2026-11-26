/** Changes the reviewer of the PR has to look at closely. Decided from the diff, never by the model. */
export type Gate = "tests" | "dependency" | "security";
