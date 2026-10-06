import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { SupabaseJwtService } from '../services/supabase-jwt.service.js';
import type {
  AuthenticatedUser,
  RolUsuario,
} from '../interfaces/authenticated-user.interface.js';

interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

const ROLES_VALIDOS: readonly RolUsuario[] = [
  'propietario',
  'administrador',
  'peon',
  'veterinario',
] as const;

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: SupabaseJwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Verificar si la ruta o controlador está marcado como público
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // 2. Extraer el token Bearer del encabezado Authorization
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      this.logger.debug(
        'Petición sin Bearer token en el encabezado Authorization.',
      );
      throw new UnauthorizedException(
        'Encabezado Authorization con Bearer token requerido',
      );
    }

    // 3. Verificar el JWT contra el JWKS de Supabase
    let payload: Record<string, unknown>;
    try {
      payload = (await this.jwtService.verifyToken(token)) as Record<
        string,
        unknown
      >;
    } catch (error) {
      // El detalle de `jose` (algoritmo, claim que falló, desfase del reloj)
      // queda solo en el log: decirle a un atacante por qué falló su token le
      // ahorra trabajo.
      this.logger.warn(
        `Verificación de JWT fallida: ${(error as Error).message}`,
      );
      throw new UnauthorizedException(
        'Token de autenticación inválido o expirado.',
      );
    }

    // 4. Extraer y validar claims inyectadas por el Custom Access Token Hook o desde app_metadata
    const appMetadata = payload['app_metadata'] as
      Record<string, unknown> | undefined;
    const tenantId = (payload['tenant_id'] ||
      (appMetadata && appMetadata['tenant_id'])) as string | undefined;
    const rol = (payload['rol'] || (appMetadata && appMetadata['rol'])) as
      RolUsuario | undefined;

    if (!tenantId || !rol) {
      this.logger.warn('JWT sin claims de tenant_id o rol.');
      throw new UnauthorizedException(
        'El token de autenticación no contiene claims de tenant_id o rol.',
      );
    }

    if (!ROLES_VALIDOS.includes(rol)) {
      throw new UnauthorizedException(
        `El rol '${rol}' presente en el token no es válido en el sistema.`,
      );
    }

    const userId = (payload['sub'] || payload['user_id']) as string;
    const email = (payload['email'] || '') as string;

    if (!userId) {
      throw new UnauthorizedException(
        'El token no contiene identificador de usuario (sub).',
      );
    }

    // 5. Adjuntar usuario tipado a la petición
    request.user = {
      userId,
      tenantId,
      rol,
      email,
      rawClaims: payload,
    };

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
