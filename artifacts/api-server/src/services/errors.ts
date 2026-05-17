export class NotFoundError extends Error {
  readonly status = 404;
  constructor(entity: string, id?: number | string) {
    super(id != null ? `${entity} #${id} not found` : `${entity} not found`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(reason = "Forbidden") {
    super(reason);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  constructor(reason: string) {
    super(reason);
    this.name = "ConflictError";
  }
}

export class ValidationError extends Error {
  readonly status = 400;
  constructor(reason: string) {
    super(reason);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(reason = "Unauthorized") {
    super(reason);
    this.name = "UnauthorizedError";
  }
}
