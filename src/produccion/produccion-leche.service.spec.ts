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
import { CreateProduccionLecheDto, FilaImportarProduccionLecheDto } from './dto/produccion-leche.dto.js';
import { addCalendarDays, todayIsoDate } from '../tratamientos/retiro-calc.js';

const TENANT = 'tenant-1';
const USER = 'user-1';
const ANIMAL_ID = '00000000-0000-4000-8000-000000000010';
const hoy = todayIsoDate();

it('el DTO de lote conserva el prefijo del arete interno', async () => {
  const pipe = new ValidationPipe({ transform: true });
  for (const areteInterno of ['#101', '101', '00101']) {
    const fila = await pipe.transform(
      { areteInterno, fecha: hoy, turno: 'MANANA', litros: 10 },
      { type: 'body', metatype: FilaImportarProduccionLecheDto },
    ) as FilaImportarProduccionLecheDto;
    expect(fila.areteInterno).toBe(areteInterno);
  }
});

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
      expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY id FOR UPDATE'), [
        TENANT, [ANIMAL_ID],
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

    it('rechaza producción nueva para un animal dado de baja', async () => {
      animal = { ...animal, activo: false };
      await expect(service.create(TENANT, USER, dto(), manager)).rejects.toBeInstanceOf(
        ConflictException,
      );
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

  describe('update', () => {
    it('versiona los litros de un registro activo y conserva el original', async () => {
      const evento = { id: 'p1', animalId: ANIMAL_ID, fechaEvento: hoy, revertido: false, notas: 'prev' } as Evento;
      const detalle = { eventoId: 'p1', turno: 'MANANA', litros: 8, disposicion: 'COMERCIALIZABLE', tratamientoEventoId: null } as EventoProduccionLeche;
      findOne.mockImplementation(async (cls: unknown) => {
        if (cls === Evento) return evento;
        if (cls === EventoProduccionLeche) return detalle;
        return null;
      });
      const actualizado = await service.update(TENANT, USER, 'p1', { litros: 11.5, notas: 'corregido', motivo: 'Digitación incorrecta' }, manager);
      expect(actualizado.litros).toBe(11.5);
      expect(detalle.litros).toBe(8);
      expect(evento.revertido).toBe(true);
      expect(actualizado.eventoCorrigeId).toBe('p1');
      expect(save).toHaveBeenCalledWith(EventoProduccionLeche, expect.objectContaining({ litros: 11.5 }));
    });

    it('rechaza actualizar un registro revertido', async () => {
      findOne.mockImplementation(async (cls: unknown) => {
        if (cls === Evento) return { id: 'p1', revertido: true, animalId: ANIMAL_ID } as Evento;
        if (cls === EventoProduccionLeche) return { eventoId: 'p1' } as EventoProduccionLeche;
        return null;
      });
      await expect(
        service.update(TENANT, USER, 'p1', { litros: 10 }, manager),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('historial', () => {
    it('lista el rango de la finca en una consulta sin registros revertidos', async () => {
      const evento = { id: 'p1', animalId: ANIMAL_ID, fechaEvento: '2026-10-21',
        revertido: false, usuarioId: USER, notas: null, fechaRegistro: new Date() } as Evento;
      find.mockImplementation(async (cls: unknown) => cls === EventoProduccionLeche
        ? [{ eventoId: 'p1', evento, turno: 'MANANA', litros: 8, disposicion: 'COMERCIALIZABLE', tratamientoEventoId: null }]
        : []);
      const registros = await service.listarRegistros(TENANT, manager, '2026-10-21', '2026-10-21');
      expect(registros).toMatchObject([{ id: 'p1', animalId: ANIMAL_ID, litros: 8 }]);
      expect(find).toHaveBeenCalledWith(EventoProduccionLeche, expect.objectContaining({
        where: { evento: expect.objectContaining({ tenantId: TENANT, revertido: false, tipo: 'PRODUCCION_LECHE' }) },
      }));
    });

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

  describe('importarLote (OBS-004)', () => {
    it('importa múltiples registros válidos y calcula totales comerciales y de descarte', async () => {
      const animal1 = { id: 'uuid-1', tenantId: TENANT, sexo: 'Hembra', areteInterno: '101' };
      const animal2 = { id: 'uuid-2', tenantId: TENANT, sexo: 'Hembra', areteInterno: '102' };

      findOne.mockImplementation(async (cls: unknown, opts: any) => {
        if (cls === Animal) {
          if (opts?.where?.areteInterno === '101') return animal1;
          if (opts?.where?.areteInterno === '102') return animal2;
          return null;
        }
        if (cls === EventoProduccionLeche) return null;
        return null;
      });

      const r = await service.importarLote(
        TENANT,
        USER,
        {
          filas: [
            { fecha: hoy, turno: 'Mañana', areteInterno: '101', litros: 15.5 },
            { fecha: hoy, turno: 'Mañana', areteInterno: '102', litros: 20 },
          ] as any,
        },
        manager,
      );

      expect(r.totalImportados).toBe(2);
      expect(r.litrosTotales).toBe(35.5);
      expect(r.litrosComercializables).toBe(35.5);
      expect(r.litrosDescarte).toBe(0);
      expect(r.registros).toHaveLength(2);
    });

    it('bloquea el lote completo si hay registros duplicados en el mismo archivo', async () => {
      await expect(
        service.importarLote(
          TENANT,
          USER,
          {
            filas: [
              { fecha: hoy, turno: 'Mañana', areteInterno: '101', litros: 10 },
              { fecha: hoy, turno: 'Mañana', areteInterno: '101', litros: 12 },
            ] as any,
          },
          manager,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('falla con 404 y número de fila si el animal no existe o no está activo', async () => {
      findOne.mockImplementation(async (cls: unknown) => {
        if (cls === Animal) return null;
        return null;
      });

      await expect(
        service.importarLote(
          TENANT,
          USER,
          {
            filas: [{ fecha: hoy, turno: 'Mañana', areteInterno: '999', litros: 10 }] as any,
          },
          manager,
        ),
      ).rejects.toThrow(/Fila 1: No se encontró un animal activo/);
    });

    it('falla si el animal es macho', async () => {
      findOne.mockImplementation(async (cls: unknown) => {
        if (cls === Animal) return { id: 'macho-1', areteInterno: 'M-1', sexo: 'Macho', tenantId: TENANT };
        return null;
      });

      await expect(
        service.importarLote(
          TENANT,
          USER,
          {
            filas: [{ fecha: hoy, turno: 'Mañana', areteInterno: 'M-1', litros: 10 }] as any,
          },
          manager,
        ),
      ).rejects.toThrow(/es macho/);
    });

    it('falla si la hembra no está en lactancia', async () => {
      findOne.mockImplementation(async (cls: unknown) => {
        if (cls === Animal) return { id: 'vaca-1', areteInterno: 'V-1', sexo: 'Hembra', tenantId: TENANT };
        return null;
      });
      estadoDe.mockResolvedValueOnce({ enLactancia: false });

      await expect(
        service.importarLote(
          TENANT,
          USER,
          {
            filas: [{ fecha: hoy, turno: 'Mañana', areteInterno: 'V-1', litros: 10 }] as any,
          },
          manager,
        ),
      ).rejects.toThrow(/no está en lactancia/);
    });

    it('falla si la fecha es futura', async () => {
      const fechaFutura = addCalendarDays(hoy, 2);
      await expect(
        service.importarLote(
          TENANT,
          USER,
          {
            filas: [{ fecha: fechaFutura, turno: 'Mañana', areteInterno: '101', litros: 10 }] as any,
          },
          manager,
        ),
      ).rejects.toThrow(/posterior a hoy/);
  });
});
});
