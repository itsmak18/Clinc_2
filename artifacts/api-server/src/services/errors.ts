import { E, type ErrorDef } from "../errors";

export class NotFoundError extends Error {
  readonly status = 404;
  readonly errorDef: ErrorDef = E.DOMAIN_NOT_FOUND;
  constructor(entity: string, id?: number | string) {
    super(id != null ? `${entity} #${id} not found` : `${entity} not found`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  readonly errorDef: ErrorDef = E.DOMAIN_FORBIDDEN;
  constructor(reason = "Forbidden") {
    super(reason);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  readonly errorDef: ErrorDef = E.DOMAIN_CONFLICT;
  constructor(reason: string) {
    super(reason);
    this.name = "ConflictError";
  }
}

export class ValidationError extends Error {
  readonly status = 400;
  readonly errorDef: ErrorDef = E.DOMAIN_VALIDATION;
  constructor(reason: string) {
    super(reason);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  readonly errorDef: ErrorDef = E.DOMAIN_UNAUTHORIZED;
  constructor(reason = "Unauthorized") {
    super(reason);
    this.name = "UnauthorizedError";
  }
}

export class ConsentRequiredError extends Error {
  readonly status = 422;
  readonly errorDef: ErrorDef = E.CONSENT_REQUIRED;
  constructor(reason = "Patient consent is required for this action") {
    super(reason);
    this.name = "ConsentRequiredError";
  }
}
