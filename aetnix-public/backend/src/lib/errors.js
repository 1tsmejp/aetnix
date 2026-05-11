export class AppError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message, details = null) {
  return new AppError(400, message, details);
}

export function unauthorized(message = 'Authentication required') {
  return new AppError(401, message);
}

export function forbidden(message = 'Forbidden') {
  return new AppError(403, message);
}

export function notFound(message = 'Not found') {
  return new AppError(404, message);
}
