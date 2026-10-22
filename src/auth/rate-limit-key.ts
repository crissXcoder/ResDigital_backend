import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { isUUID } from 'class-validator';
import type { SupabaseJwtService } from './services/supabase-jwt.service.js';

export function createRateLimitKey(
  jwtService: Pick<SupabaseJwtService, 'verifyToken'>,
): (request: Request) => Promise<string> {
  return async (request) => {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme === 'Bearer' && token) {
      try {
        const claims = await jwtService.verifyToken(token);
        if (claims.sub && isUUID(claims.sub)) {
          return `user:${claims.sub}`;
        }
      } catch {
        // Un token inválido conserva el contador anónimo; AuthGuard deniega el acceso.
      }
    }

    // shortcut: anónimos comparten peer detrás del proxy; separar solo con ingress confiable.
    return `peer:${ipKeyGenerator(request.socket.remoteAddress ?? 'unknown')}`;
  };
}
