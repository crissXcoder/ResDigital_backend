import { describe, expect, it } from 'vitest';
import { AuthController } from '../auth.controller.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { PotrerosController } from '../../potreros/potreros.controller.js';
import { PesajesController } from '../../pesajes/pesajes.controller.js';
import { TratamientosController } from '../../tratamientos/tratamientos.controller.js';
import { ReproductiveController } from '../../reproductivo/reproductive.controller.js';
import { AnimalesController } from '../../animales/animales.controller.js';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../guards/roles.guard.js';

function rolesOf(controller: object, method: string): string[] | undefined {
  const handler = (controller as Record<string, unknown>)[method];
  return typeof handler === 'function'
    ? Reflect.getMetadata(ROLES_KEY, handler)
    : undefined;
}

describe('Matriz de roles en rutas de escritura', () => {
  it('reserva gestión de usuarios e invitaciones al propietario', () => {
    expect(rolesOf(AuthController.prototype, 'invitarUsuario')).toEqual([
      'propietario',
    ]);
  });

  it('permite al peón registrar pesajes y mover animales, pero no administrar potreros', () => {
    expect(rolesOf(PesajesController.prototype, 'create')).toContain('peon');
    expect(rolesOf(PotrerosController.prototype, 'asignarAnimales')).toContain(
      'peon',
    );
    expect(rolesOf(PotrerosController.prototype, 'create')).not.toContain(
      'peon',
    );
    expect(rolesOf(PotrerosController.prototype, 'update')).not.toContain(
      'peon',
    );
  });

  it('distingue tratamientos nuevos, correcciones y eventos reproductivos', () => {
    expect(rolesOf(TratamientosController.prototype, 'create')).toContain(
      'peon',
    );
    expect(rolesOf(TratamientosController.prototype, 'update')).not.toContain(
      'peon',
    );
    expect(rolesOf(ReproductiveController.prototype, 'registrarServicio')).toContain(
      'peon',
    );
    expect(
      rolesOf(ReproductiveController.prototype, 'registrarDiagnostico'),
    ).not.toContain('peon');
    expect(rolesOf(ReproductiveController.prototype, 'registrarParto')).toContain(
      'peon',
    );
    expect(rolesOf(ReproductiveController.prototype, 'registrarSecado')).toContain(
      'peon',
    );
  });

  it('reserva la carga de documentos al propietario y administrador', () => {
    expect(rolesOf(AnimalesController.prototype, 'createDocumento')).toEqual([
      'propietario',
      'administrador',
    ]);
  });

  it('deniega al peón la carga directa y permite al administrador', () => {
    const guard = new RolesGuard(new Reflector());
    const context = (rol: 'peon' | 'administrador') => ({
      getHandler: () => AnimalesController.prototype.createDocumento,
      getClass: () => AnimalesController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: 'fixture-user', tenantId: 'fixture-tenant', rol },
        }),
      }),
    }) as unknown as ExecutionContext;

    expect(() => guard.canActivate(context('peon'))).toThrow(ForbiddenException);
    expect(guard.canActivate(context('administrador'))).toBe(true);
  });
});
