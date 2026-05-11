export function asyncHandler(fn) {
  return async function wrapped(req, res, next) {
    try {
      await fn(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function pickRequestMeta(req) {
  return {
    userAgent: req.get('user-agent') ?? null,
    ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
  };
}
