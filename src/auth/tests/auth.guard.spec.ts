import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../guards/auth.guard.js';
import { SupabaseJwtService } from '../services/supabase-jwt.service.js';

describe('AuthGuard', () => {
  let authGuard: AuthGuard;
  let reflector: Reflector;
  let jwtService: SupabaseJwtService;

  const createMockContext = (authHeader?: string): ExecutionContext => {
    const mockRequest: {
      headers: { authorization?: string };
      user?: unknown;
    } = {
      headers: {
        authorization: authHeader,
      },
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    jwtService = {
      verifyToken: vi.fn(),
    } as unknown as SupabaseJwtService;

    authGuard = new AuthGuard(reflector, jwtService);
  });

  it('debe permitir el acceso directo si la ruta está marcada con @Public()', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const verifySpy = vi.spyOn(jwtService, 'verifyToken');
    const context = createMockContext(undefined);

    const result = await authGuard.canActivate(context);

    expect(result).toBe(true);
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('debe rechazar con 401 si no se envía encabezado Authorization', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext(undefined);

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('debe rechazar con 401 si el token no tiene formato Bearer', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext('Basic dXNlcjpwYXNz');

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('debe rechazar con 401 si jwtService.verifyToken arroja error (expirado o firma inválida)', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    vi.spyOn(jwtService, 'verifyToken').mockRejectedValue(
      new Error('token expired'),
    );

    const context = createMockContext('Bearer token_invalido');

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('CRÍTICO: debe rechazar con 401 si el JWT NO contiene tenant_id (falla de Custom Access Token Hook)', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    vi.spyOn(jwtService, 'verifyToken').mockResolvedValue({
      sub: 'user-uuid-123',
      email: 'test@resdigital.com',
      rol: 'propietario',
      // FALTA tenant_id
    });

    const context = createMockContext('Bearer token_sin_tenant');

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(authGuard.canActivate(context)).rejects.toThrow(
      /no contiene claims de tenant_id o rol/i,
    );
  });

  it('CRÍTICO: debe rechazar con 401 si el JWT NO contiene rol', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    vi.spyOn(jwtService, 'verifyToken').mockResolvedValue({
      sub: 'user-uuid-123',
      email: 'test@resdigital.com',
      tenant_id: 'tenant-uuid-456',
      // FALTA rol
    });

    const context = createMockContext('Bearer token_sin_rol');

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(authGuard.canActivate(context)).rejects.toThrow(
      /no contiene claims de tenant_id o rol/i,
    );
  });

  it('debe rechazar con 401 si el rol contenido en el token no pertenece a los roles válidos del sistema', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    vi.spyOn(jwtService, 'verifyToken').mockResolvedValue({
      sub: 'user-uuid-123',
      email: 'test@resdigital.com',
      tenant_id: 'tenant-uuid-456',
      rol: 'superadmin_falso',
    });

    const context = createMockContext('Bearer token_rol_invalido');

    await expect(authGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(authGuard.canActivate(context)).rejects.toThrow(
      /no es válido en el sistema/i,
    );
  });

  it('debe autenticar exitosamente y adjuntar request.user tipado cuando tenant_id y rol están presentes', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    vi.spyOn(jwtService, 'verifyToken').mockResolvedValue({
      sub: 'user-uuid-123',
      email: 'cristhian@resdigital.cr',
      tenant_id: 'finca-uuid-789',
      rol: 'propietario',
    });

    const context = createMockContext('Bearer token_valido');
    const result = await authGuard.canActivate(context);

    expect(result).toBe(true);

    const request = context.switchToHttp().getRequest<{
      user: {
        userId: string;
        tenantId: string;
        rol: string;
        email: string;
      };
    }>();

    expect(request.user).toEqual({
      userId: 'user-uuid-123',
      tenantId: 'finca-uuid-789',
      rol: 'propietario',
      email: 'cristhian@resdigital.cr',
      rawClaims: expect.objectContaining({
        sub: 'user-uuid-123',
        tenant_id: 'finca-uuid-789',
        rol: 'propietario',
      }),
    });
  });
});
