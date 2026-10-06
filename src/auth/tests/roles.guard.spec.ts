import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../guards/roles.guard.js';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

describe('RolesGuard', () => {
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  const createMockContext = (user?: Partial<AuthenticatedUser>): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);
  });

  it('debe permitir el acceso si no hay roles requeridos en la ruta', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({ rol: 'peon' });

    expect(rolesGuard.canActivate(context)).toBe(true);
  });

  it('debe rechazar con 403 si el usuario no tiene rol asignado', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['propietario']);
    const context = createMockContext(undefined);

    expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('debe rechazar con 403 si el rol del usuario no coincide con los roles requeridos', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      'propietario',
      'administrador',
    ]);
    const context = createMockContext({
      userId: '1',
      tenantId: '1',
      rol: 'peon',
      email: 'peon@finca.cr',
      rawClaims: {},
    });

    expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => rolesGuard.canActivate(context)).toThrow(
      /se requiere uno de los roles/i,
    );
  });

  it('debe permitir el acceso si el rol del usuario está dentro de los roles autorizados', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      'propietario',
      'administrador',
    ]);
    const context = createMockContext({
      userId: '1',
      tenantId: '1',
      rol: 'propietario',
      email: 'propietario@finca.cr',
      rawClaims: {},
    });

    expect(rolesGuard.canActivate(context)).toBe(true);
  });
});
