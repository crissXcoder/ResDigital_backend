import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ProduccionLecheService, resolverRango, sumarResumen } from './produccion-leche.service.js';
import { resolverDisposicion } from './disposicion-calc.js';
import type { LactanciaService } from './lactancia.service.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { Evento } from '../eventos/entities/evento.entity.js';
import { EventoTratamiento } from '../tratamientos/entities/evento-tratamiento.entity.js';
import { EventoProduccionLeche } from './entities/evento-produccion-leche.entity.js';
import { CreateProduccionLecheDto } from './dto/produccion-leche.dto.js';
import { addCalendarDays, todayIsoDate } from '../tratamientos/retiro-calc.js';

const TENANT = 'tenant-1';
const USER = 'user-1';
const ANIMAL_ID = '00000000-0000-4000-8000-000000000010';
const hoy = todayIsoDate();

describe('resolverDisposicion', () => {
  const t = (eventoId: string, fechaAplicacion: string, fechaLiberacionLeche: string) => ({
    eventoId,
    fechaAplicacion,
    fechaLiberacionLeche,
  });

  it('bajo retiro es descarte con el tratamiento de origen', () => {
    expect(resolverDisposicion([t('t1', '2026-10-01', '2026-10-06')], '2026-10-03')).toEqual({
      disposicion: 'DESCARTE',
      tratamientoEventoId: 't1',
      fechaLiberacionLeche: '2026-10-06',
    });
  });

  it('el día exacto de liberación es comercializable', () => {
    expect(
      resolverDisposicion([t('t1', '2026-10-01', '2026-10-06')], '2026-10-06').disposicion,
    ).toBe('COMERCIALIZABLE');
  });

  it('un tratamiento posterior a la producción no la afecta', () => {
    expect(
      resolverDisposicion([t('t1', '2026-10-01', '2026-10-06')], '2026-09-28').disposicion,
    ).toBe('COMERCIALIZABLE');
  });

  it('con varios tratamientos toma el de liberación más tardía', () => {
    const r = resolverDisposicion(
      [t('t1', '2026-10-01', '2026-10-05'), t('t2', '2026-10-02', '2026-10-12')],
      '2026-10-03',
    );
    expect(r.tratamientoEventoId).toBe('t2');
    expect(r.fechaLiberacionLeche).toBe('2026-10-12');
  });
});

describe('resumen: rango y totales', () => {
  it('por defecto toma los últimos 30 días hasta hoy', () => {
    expect(resolverRango(undefined, undefined, '2026-10-06')).toEqual({
      desde: '2026-09-07',
      hasta: '2026-10-06',
      error: null,
    });
  });

  it('rechaza un rango invertido o mayor a 366 días', () => {
    expect(resolverRango('2026-10-07', '2026-10-06', '2026-10-06').error).toMatch(/posterior/);
    expect(resolverRango('2025-01-01', '2026-01-02', '2026-10-06').error).toMatch(/366/);
    expect(resolverRango('2025-01-02', '2026-01-02', '2026-10-06').error).toBeNull();
  });

  it('separa producido, comercializable y descarte', () => {
    const r = sumarResumen('2026-10-01', '2026-10-02', [
      { fecha: '2026-10-01', producidos: '70.5', comercializables: '60.5', descarte: '10.0', registros: '6' },
      { fecha: '2026-10-02', producidos: '49.5', comercializables: '39.5', descarte: '10.0', registros: '4' },
    ]);
    expect(r).toMatchObject({
      litrosProducidos: 120,
      litrosComercializables: 100,
      litrosDescarte: 20,
      registros: 10,
    });
    expect(r.porFecha).toHaveLength(2);
  });

  it('un día sin descarte suma 0', () => {
    const r = sumarResumen('2026-10-01', '2026-10-01', [
      { fecha: '2026-10-01', producidos: '10', comercializables: '10', descarte: null, registros: 1 },
    ]);
    expect(r.litrosDescarte).toBe(0);
  });
});

describe('Validación del DTO de producción', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const base = { animalId: ANIMAL_ID, fecha: '2026-10-05', turno: 'MANANA', litros: 12.5 };
  const validar = (body: object) =>
    pipe.transform(body, { type: 'body', metatype: CreateProduccionLecheDto });

  it('acepta el payload válido', async () => {
    await expect(validar(base)).resolves.toBeInstanceOf(CreateProduccionLecheDto);
  });

  it('rechaza que el cliente envíe la disposición', async () => {
    await expect(validar({ ...base, disposicion: 'COMERCIALIZABLE' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([0, -1, 75, 12.55])('rechaza %s litros', async (litros) => {
    await expect(validar({ ...base, litros })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un turno desconocido', async () => {
    await expect(validar({ ...base, turno: 'NOCHE' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ProduccionLecheService', () => {
  const estadoDe = vi.fn();
  const service = new ProduccionLecheService({ estadoDe } as unknown as LactanciaService);

  let animal: Partial<Animal> | null;
  let duplicado: object | null;
  let tratamientos: Partial<EventoTratamiento>[];
  let original: Partial<Evento> | null;
  let detalleOriginal: object | null;

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

  const dto = (extra: Partial<CreateProduccionLecheDto> = {}): CreateProduccionLecheDto => ({
    animalId: ANIMAL_ID,
    fecha: hoy,
    turno: 'MANANA',
    litros: 12.5,
    ...extra,
  });

  let seq = 0;
  beforeEach(() => {
    vi.clearAllMocks();
    seq = 0;
    animal = { id: ANIMAL_ID, tenantId: TENANT, sexo: 'Hembra', areteInterno: 'A-1' };
    duplicado = null;
    tratamientos = [];
    original = null;
    detalleOriginal = null;
    estadoDe.mockResolvedValue({ enLactancia: true, fechaInicio: '2026-01-01', eventoInicioId: 'p1' });
    findOne.mockImplementation(async (cls: unknown) => {
      if (cls === Animal) return animal;
      if (cls === EventoProduccionLeche) return duplicado ?? detalleOriginal;
      if (cls === Evento) return original;
      return null;
    });
    find.mockImplementation(async (cls: unknown) =>
      cls === EventoTratamiento ? tratamientos : [],
    );
    save.mockImplementation(async (cls: unknown, entity: object) =>
      cls === Evento && !(entity as { id?: string }).id
        ? { id: `ev-${++seq}`, fechaRegistro: new Date(), ...entity }
        : entity,
    );
  });

  describe('registro', () => {
    it('sin retiro guarda comercializable con el usuario', async () => {
      const r = await service.create(TENANT, USER, dto(), manager);
      expect(r).toMatchObject({
        id: 'ev-1',
        litros: 12.5,
        turno: 'MANANA',
        disposicion: 'COMERCIALIZABLE',
        tratamientoEventoId: null,
        usuarioId: USER,
      });
      expect(save).toHaveBeenCalledWith(
        Evento,
        expect.objectContaining({ tipo: 'PRODUCCION_LECHE', fechaEvento: hoy, usuarioId: USER }),
      );
      expect(query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), [
        `produccion-animal:${ANIMAL_ID}`,
      ]);
    });

    it('bajo retiro guarda los litros como descarte con el tratamiento', async () => {
      tratamientos = [
        {
          eventoId: 'trat-1',
          fechaLiberacionLeche: addCalendarDays(hoy, 3),
          evento: { fechaEvento: addCalendarDays(hoy, -2) } as Evento,
        },
      ];
      const r = await service.create(TENANT, USER, dto({ litros: 10 }), manager);
      expect(r).toMatchObject({
        litros: 10,
        disposicion: 'DESCARTE',
        tratamientoEventoId: 'trat-1',
        fechaLiberacionLeche: addCalendarDays(hoy, 3),
      });
      expect(save).toHaveBeenCalledWith(
        EventoProduccionLeche,
        expect.objectContaining({ litros: 10, disposicion: 'DESCARTE', tratamientoEventoId: 'trat-1' }),
      );
    });

    it('solo consulta tratamientos vigentes y aplicados hasta la fecha', async () => {
      await service.create(TENANT, USER, dto(), manager);
      const opciones = find.mock.calls.find(([cls]) => cls === EventoTratamiento)?.[1] as {
        where: { evento: { revertido: boolean; tipo: string } };
      };
      expect(opciones.where.evento).toMatchObject({ revertido: false, tipo: 'TRATAMIENTO' });
    });

    it('rechaza un macho', async () => {
      animal = { ...animal, sexo: 'Macho' };
      await expect(service.create(TENANT, USER, dto(), manager)).rejects.toThrow(/macho/);
      expect(save).not.toHaveBeenCalled();
    });

    it('rechaza una vaca seca o novilla (no lactante)', async () => {
      estadoDe.mockResolvedValue({ enLactancia: false, fechaInicio: null, eventoInicioId: null });
      await expect(service.create(TENANT, USER, dto(), manager)).rejects.toThrow(
        /no está en lactancia/,
      );
      expect(save).not.toHaveBeenCalled();
    });

    it('evalúa la lactancia en la fecha de producción', async () => {
      const ayer = addCalendarDays(hoy, -1);
      await service.create(TENANT, USER, dto({ fecha: ayer }), manager);
      expect(estadoDe).toHaveBeenCalledWith(animal, TENANT, manager, ayer);
    });

    it('rechaza una fecha futura', async () => {
      await expect(
        service.create(TENANT, USER, dto({ fecha: addCalendarDays(hoy, 1) }), manager),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('animal de otra finca responde 404', async () => {
      animal = null;
      await expect(service.create(TENANT, USER, dto(), manager)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('un turno ya registrado responde 409', async () => {
      duplicado = { eventoId: 'previo' };
      await expect(service.create(TENANT, USER, dto(), manager)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('anulación', () => {
    beforeEach(() => {
      original = {
        id: 'prod-1',
        tenantId: TENANT,
        animalId: ANIMAL_ID,
        tipo: 'PRODUCCION_LECHE',
        revertido: false,
      };
      detalleOriginal = { eventoId: 'prod-1' };
    });

    it('marca el original revertido y crea el marcador con el motivo', async () => {
      const r = await service.anular(TENANT, USER, 'prod-1', { motivo: 'litros mal digitados' }, manager);
      expect(original?.revertido).toBe(true);
      expect(r).toMatchObject({ id: 'prod-1', motivo: 'litros mal digitados' });
      expect(save).toHaveBeenCalledWith(
        Evento,
        expect.objectContaining({ eventoCorrigeId: 'prod-1', notas: 'litros mal digitados' }),
      );
      expect(create).not.toHaveBeenCalledWith(EventoProduccionLeche, expect.anything());
    });

    it('permite registrar de nuevo el mismo turno tras anular', async () => {
      await service.anular(TENANT, USER, 'prod-1', { motivo: 'error' }, manager);
      detalleOriginal = null;
      await expect(service.create(TENANT, USER, dto(), manager)).resolves.toMatchObject({
        disposicion: 'COMERCIALIZABLE',
      });
    });

    it('inexistente o de otra finca responde 404', async () => {
      original = null;
      await expect(
        service.anular(TENANT, USER, 'prod-x', { motivo: 'error' }, manager),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ya anulada responde 400', async () => {
      original = { ...original, revertido: true };
      await expect(
        service.anular(TENANT, USER, 'prod-1', { motivo: 'error' }, manager),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('historial', () => {
    it('incluye la liberación del tratamiento y los anulados marcados', async () => {
      const ev = (id: string, revertido: boolean) =>
        ({ id, animalId: ANIMAL_ID, fechaEvento: hoy, revertido, usuarioId: USER, notas: null, fechaRegistro: new Date() }) as Evento;
      find.mockImplementation(async (cls: unknown) => {
        if (cls === EventoProduccionLeche) {
          return [
            { eventoId: 'a', turno: 'MANANA', litros: '8.5', disposicion: 'DESCARTE', tratamientoEventoId: 't1', evento: ev('a', false) },
            { eventoId: 'b', turno: 'TARDE', litros: '5.0', disposicion: 'COMERCIALIZABLE', tratamientoEventoId: null, evento: ev('b', true) },
          ];
        }
        if (cls === EventoTratamiento) return [{ eventoId: 't1', fechaLiberacionLeche: '2026-10-09' }];
        return [];
      });
      const r = await service.findAllByAnimal(TENANT, ANIMAL_ID, manager);
      expect(r[0]).toMatchObject({ litros: 8.5, disposicion: 'DESCARTE', fechaLiberacionLeche: '2026-10-09' });
      expect(r[1]).toMatchObject({ revertido: true, fechaLiberacionLeche: null });
    });

    it('animal de otra finca responde 404', async () => {
      animal = null;
      await expect(service.findAllByAnimal(TENANT, ANIMAL_ID, manager)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('resumen', () => {
    it('solo cuenta registros no revertidos del tenant', async () => {
      const condiciones: string[] = [];
      const qb = {
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn((c: string) => (condiciones.push(c), qb)),
        andWhere: vi.fn((c: string) => (condiciones.push(c), qb)),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue([]),
      };
      const conQb = { ...manager, createQueryBuilder: vi.fn(() => qb) } as unknown as EntityManager;
      const r = await service.resumen(TENANT, conQb, '2026-10-01', '2026-10-05');
      expect(condiciones).toContain('e.revertido = false');
      expect(condiciones).toContain('e.tenant_id = :tenantId');
      expect(r).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-05', litrosProducidos: 0 });
    });

    it('un rango invertido responde 400', async () => {
      await expect(
        service.resumen(TENANT, manager, '2026-10-05', '2026-10-01'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
