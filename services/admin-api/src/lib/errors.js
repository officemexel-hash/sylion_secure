export class AppError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function notFound(resource, id) {
  return new AppError("not_found", `${resource} not found`, 404, { resource, id });
}

export function forbidden(action) {
  return new AppError("forbidden", `Action is not allowed: ${action}`, 403, { action });
}

export function validationError(message, details = {}) {
  return new AppError("validation_error", message, 422, details);
}

