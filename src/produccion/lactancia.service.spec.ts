import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LactanciaService } from './lactancia.service.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { Evento } from '../eventos/entities/evento.entity.js';
import { EventoParto } from '../reproductivo/entities/evento-parto.entity.js';
import type { ReproductiveStateService } from '../reproductivo/services/reproductive-state.service.js';
import { addCalendarDays, todayIsoDate } from '../tratamientos/retiro-calc.js';

const TENANT = 'tenant-1';
const USER = 'user-1';
const hoy = todayIsoDate();
const hace = (dias: number) => addCalendarDays(hoy, -dias);

const animal = (id: string, sexo = 'Hembra', arete = id): Partial<Animal> => ({
  id,
  tenantId: TENANT,
  sexo,
  areteInterno: arete,
  nombre: `Animal ${id}`,
  activo: true,
});

const evento = (
  id: string,
  animalId: string,
  tipo: Evento['tipo'],
  fechaEvento: string,
): Partial<Evento> => ({
  id,
  animalId,
  tipo,
  fechaEvento,
  fechaRegistro: new Date(`${fechaEvento}T12:00:00Z`),
  revertido: false,
});

describe('LactanciaService', () => {
  const calcularEstado = vi.fn();
  const service = new LactanciaService({
    calcularEstado,
  } as unknown as ReproductiveStateService);

  let animales: Partial<Animal>[];
  let eventos: Partial<Evento>[];
  let partos: Partial<EventoParto>[];

  const findOne = vi.fn();
  const find = vi.fn();
  const create = vi.fn((_cls: unknown, data: object) => ({ ...data }));
  const save = vi.fn();
  const query = vi.fn();
  const manager = {
    findOne,
    find,
    create,
    save,
    query,
    transaction: vi.fn((cb: (trx: unknown) => unknown) => cb(manager)),
  } as unknown as EntityManager;

  beforeEach(() => {
    vi.clearAllMocks();
    animales = [];
    eventos = [];
    partos = [];
    find.mockImplementation(async (cls: unknown) => {
      if (cls === Animal) return animales;
      if (cls === Evento) return eventos;
      if (cls === EventoParto) return partos;
      return [];
    });
    findOne.mockImplementation(
      async (_cls: unknown, opts: { where: { id: string } }) =>
        animales.find((a) => a.id === opts.where.id) ?? null,
    );
    save.mockImplementation(async (_cls: unknown, entity: object) => ({
      id: 'nuevo',
      ...entity,
    }));
    calcularEstado.mockResolvedValue({ estadoActual: 'Vacía' });
  });

  describe('consultas', () => {
    it('vaca con parto y sin secado está en lactancia', async () => {
      animales = [animal('v1')];
      eventos = [evento('p1', 'v1', 'PARTO', hace(40))];
      const estado = await service.getEstado(TENANT, 'v1', manager);
      expect(estado).toMatchObject({
        animalId: 'v1',
        enLactancia: true,
        fechaInicio: hace(40),
        eventoInicioId: 'p1',
        fechaReferencia: hoy,
      });
    });

    it('un macho es "No lactante" sin consultar eventos', async () => {
      animales = [animal('t1', 'Macho')];
      const estado = await service.getEstado(TENANT, 't1', manager);
      expect(estado.enLactancia).toBe(false);
      expect(find).not.toHaveBeenCalled();
    });

    it('animal de otra finca responde 404', async () => {
      await expect(service.getEstado(TENANT, 'ajeno', manager)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('un parto con aborto no abre la lactancia', async () => {
      animales = [animal('v1')];
      eventos = [evento('p1', 'v1', 'PARTO', hace(10))];
      partos = [{ eventoId: 'p1', facilidadParto: 'Aborto' }];
      expect((await service.getEstado(TENANT, 'v1', manager)).enLactancia).toBe(false);
    });

    it('el listado solo incluye hembras lactantes y usa consultas fijas', async () => {
      animales = [
        animal('v1', 'Hembra', 'A-02'),
        animal('v2', 'Hembra', 'A-01'),
        animal('seca', 'Hembra', 'A-03'),
        animal('novilla', 'Hembra', 'A-04'),
        animal('toro', 'Macho', 'A-05'),
      ];
      eventos = [
        evento('p1', 'v1', 'PARTO', hace(30)),
        evento('i2', 'v2', 'INICIO_LACTANCIA', hace(5)),
        evento('p3', 'seca', 'PARTO', hace(300)),
        evento('s3', 'seca', 'SECADO', hace(20)),
      ];
      const activas = await service.getActivas(TENANT, manager);
      expect(activas.map((a) => a.animalId)).toEqual(['v2', 'v1']);
      expect(activas[0]).toMatchObject({ arete: 'A-01', fechaInicio: hace(5) });
      expect(find).toHaveBeenCalledTimes(3);
    });
  });

  describe('inicio de lactancia', () => {
    it('registra el inicio para una vaca sin parto', async () => {
      animales = [animal('v1')];
      const r = await service.registrarInicio(TENANT, USER, 'v1', { fecha: hace(3) }, manager);
      expect(r).toMatchObject({ tipo: 'INICIO_LACTANCIA', fecha: hace(3), usuarioId: USER });
      expect(save).toHaveBeenCalledWith(
        Evento,
        expect.objectContaining({ tipo: 'INICIO_LACTANCIA', revertido: false }),
      );
      expect(query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), [
        'produccion-animal:v1',
      ]);
    });

    it('rechaza un macho', async () => {
      animales = [animal('t1', 'Macho')];
      await expect(
        service.registrarInicio(TENANT, USER, 't1', { fecha: hoy }, manager),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save).not.toHaveBeenCalled();
    });

    it('rechaza una fecha futura', async () => {
      animales = [animal('v1')];
      await expect(
        service.registrarInicio(TENANT, USER, 'v1', { fecha: addCalendarDays(hoy, 1) }, manager),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza el inicio si ya está en lactancia', async () => {
      animales = [animal('v1')];
      eventos = [evento('p1', 'v1', 'PARTO', hace(30))];
      await expect(
        service.registrarInicio(TENANT, USER, 'v1', { fecha: hoy }, manager),
      ).rejects.toThrow(/ya está en lactancia/);
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('fin de lactancia', () => {
    beforeEach(() => {
      animales = [animal('v1')];
      eventos = [evento('i1', 'v1', 'INICIO_LACTANCIA', hace(30))];
    });

    it('registra el fin para una vaca lactante no preñada', async () => {
      const r = await service.registrarFin(TENANT, USER, 'v1', { fecha: hoy }, manager);
      expect(r.tipo).toBe('FIN_LACTANCIA');
      expect(calcularEstado).toHaveBeenCalledWith('v1', TENANT, manager);
    });

    it('rechaza si no está en lactancia', async () => {
      eventos = [];
      await expect(
        service.registrarFin(TENANT, USER, 'v1', { fecha: hoy }, manager),
      ).rejects.toThrow(/no está en lactancia/);
    });

    it('rechaza una fecha anterior al inicio', async () => {
      await expect(
        service.registrarFin(TENANT, USER, 'v1', { fecha: hace(31) }, manager),
      ).rejects.toThrow(/anterior al inicio/);
    });

    it('una vaca preñada debe usar el secado', async () => {
      calcularEstado.mockResolvedValue({ estadoActual: 'Preñada' });
      await expect(
        service.registrarFin(TENANT, USER, 'v1', { fecha: hoy }, manager),
      ).rejects.toThrow(/secado/);
      expect(save).not.toHaveBeenCalled();
    });
  });
});
