/** Business-rule violation with an Arabic message safe to show to the owner. */
export class DomainError extends Error {
  constructor(message: string, public code = "domain_error", public details?: unknown) {
    super(message);
    this.name = "DomainError";
  }
}
