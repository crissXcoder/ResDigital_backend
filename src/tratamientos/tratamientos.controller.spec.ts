import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException, RequestMethod, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { TratamientosController } from './tratamientos.controller.js';
import type { TratamientosService } from './tratamientos.service.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type {
  AuthenticatedUser,
  RolUsuario,
} from '../auth/interfaces/authenticated-user.interface.js';

const usuario = (rol: RolUsuario): AuthenticatedUser => ({
  userId: `user-${rol}`,
  tenantId: 'tenant-1',
  rol,
  email: `${rol}@finca.cr`,
  rawClaims: {},
});

describe('TratamientosController (roles según la matriz)', () => {
  let controller: TratamientosController;
  let guard: RolesGuard;

  const contexto = (rol: RolUsuario, handler: Function): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: usuario(rol) }) }),
      getHandler: () => handler,
      getClass: () => TratamientosController,
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    controller = new TratamientosController({} as TratamientosService);
    guard = new RolesGuard(new Reflector());
  });

  it.each(['propietario', 'administrador', 'peon', 'veterinario'] as const)(
    '%s puede registrar tratamientos',
    (rol) => {
      expect(guard.canActivate(contexto(rol, controller.create))).toBe(true);
    },
  );

  it.each(['propietario', 'administrador', 'veterinario'] as const)(
    '%s puede corregir y anular',
    (rol) => {
      expect(guard.canActivate(contexto(rol, controller.corregir))).toBe(true);
      expect(guard.canActivate(contexto(rol, controller.anular))).toBe(true);
    },
  );

  it('peón recibe 403 al corregir o anular', () => {
    expect(() => guard.canActivate(contexto('peon', controller.corregir))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(contexto('peon', controller.anular))).toThrow(
      ForbiddenException,
    );
  });

  it('las lecturas no exigen rol específico', () => {
    for (const handler of [
      controller.findAllByAnimal,
      controller.getEstadoSanitario,
      controller.getRetirosActivos,
    ]) {
      expect(guard.canActivate(contexto('peon', handler))).toBe(true);
    }
  });

  it('no existe una ruta PUT de actualización destructiva', () => {
    const proto = TratamientosController.prototype as unknown as Record<
      string,
      unknown
    >;
    const metodos = Object.getOwnPropertyNames(proto)
      .filter((nombre) => nombre !== 'constructor')
      .map((nombre) => ({
        nombre,
        metodo: Reflect.getMetadata(METHOD_METADATA, proto[nombre] as object) as
          | RequestMethod
          | undefined,
        ruta: Reflect.getMetadata(PATH_METADATA, proto[nombre] as object) as
          | string
          | undefined,
      }));

    expect(metodos.some((m) => m.metodo === RequestMethod.PUT)).toBe(false);
    expect(metodos.some((m) => m.metodo === RequestMethod.PATCH)).toBe(false);
    expect(metodos.find((m) => m.nombre === 'getRetirosActivos')?.ruta).toBe(
      'retiros-activos',
    );
  });
});
