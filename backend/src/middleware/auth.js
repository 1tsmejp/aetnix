import { unauthorized } from '../lib/errors.js';
import { getSessionContextFromBearerToken } from '../services/auth-service.js';

export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') ?? '';
    const [, token] = header.match(/^Bearer\s+(.+)$/i) ?? [];

    if (!token) {
      throw unauthorized();
    }

    req.auth = await getSessionContextFromBearerToken(token);
    next();
  } catch (error) {
    next(error);
  }
}
