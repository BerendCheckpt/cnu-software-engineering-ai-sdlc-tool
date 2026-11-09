/** A rule of the domain was broken. The message is safe to show to a human or a model. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
