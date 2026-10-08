import { describe, it, expect } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  ParseUUIDPipe,
  ValidationPipe,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type {
  AuthenticatedUser,
  RolUsuario,
} from '../auth/interfaces/authenticated-user.interface.js';
import { ProduccionLecheController } from './produccion-leche.controller.js';
import { LactanciaController } from './lactancia.controller.js';
import { FechaQueryDto, RegistrarEventoLactanciaDto } from './dto/lactancia.dto.js';
import type { ProduccionLecheService } from './produccion-leche.service.js';
import type { LactanciaService } from './lactancia.service.js';

const usuario = (rol: RolUsuario): AuthenticatedUser => ({
  userId: `user-${rol}`,
  tenantId: 'tenant-1',
  rol,
  email: `${rol}@finca.cr`,
  rawClaims: {},
});

const guard = new RolesGuard(new Reflector());
const contexto = (rol: RolUsuario, handler: Function, clase: Function): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user: usuario(rol) }) }),
    getHandler: () => handler,
    getClass: () => clase,
  }) as unknown as ExecutionContext;

describe('ProduccionLecheController (roles)', () => {
  const controller = new ProduccionLecheController({} as ProduccionLecheService);
  const puede = (rol: RolUsuario, handler: Function) =>
    guard.canActivate(contexto(rol, handler, ProduccionLecheController));

  it.each(['propietario', 'administrador', 'peon'] as const)('%s registra producción', (rol) => {
    expect(puede(rol, controller.create)).toBe(true);
  });

  it('el peón no puede anular', () => {
    expect(() => puede('peon', controller.anular)).toThrow(ForbiddenException);
    expect(puede('administrador', controller.anular)).toBe(true);
  });

  it('las lecturas no exigen rol específico', () => {
    expect(puede('peon', controller.findAllByAnimal)).toBe(true);
    expect(puede('peon', controller.resumen)).toBe(true);
  });
});

describe('LactanciaController', () => {
  const controller = new LactanciaController({} as LactanciaService);
  const puede = (rol: RolUsuario, handler: Function) =>
    guard.canActivate(contexto(rol, handler, LactanciaController));
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

  it('el peón recibe 403 en inicio y fin', () => {
    expect(() => puede('peon', controller.registrarInicio)).toThrow(ForbiddenException);
    expect(() => puede('peon', controller.registrarFin)).toThrow(ForbiddenException);
  });

  it.each(['propietario', 'administrador'] as const)('%s registra inicio y fin', (rol) => {
    expect(puede(rol, controller.registrarInicio)).toBe(true);
    expect(puede(rol, controller.registrarFin)).toBe(true);
  });

  it('el peón puede consultar el estado y el listado', () => {
    expect(puede('peon', controller.getEstado)).toBe(true);
    expect(puede('peon', controller.getActivas)).toBe(true);
  });

  it('una fecha de referencia inválida responde 400', async () => {
    await expect(
      pipe.transform({ fecha: '06/10/2026' }, { type: 'query', metatype: FechaQueryDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform({ fecha: '2026-10-06T10:00:00Z' }, { type: 'body', metatype: RegistrarEventoLactanciaDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un id de animal inválido responde 400', async () => {
    await expect(
      new ParseUUIDPipe().transform('no-es-uuid', { type: 'param' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
