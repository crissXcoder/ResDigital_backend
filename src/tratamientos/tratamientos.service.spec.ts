import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { TratamientosService } from './tratamientos.service.js';
import { Evento } from '../eventos/entities/evento.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { Medicamento } from '../sanitary/entities/medicamento.entity.js';
import { EventoTratamiento } from './entities/evento-tratamiento.entity.js';
import { CreateTratamientoDto } from './dto/create-tratamiento.dto.js';
import { AnularTratamientoDto } from './dto/anular-tratamiento.dto.js';
import {
  addCalendarDays,
  computeEstadoSanitario,
  resolveRetiros,
  todayIsoDate,
  validarFechasTratamiento,
} from './retiro-calc.js';

const TENANT_ID = '00000000-0000-4000-8000-0000000000f1';
const USER_ID = '00000000-0000-4000-8000-0000000000aa';
const ANIMAL_ID = '00000000-0000-4000-8000-000000000010';
const MED_ID = '00000000-0000-4000-8000-000000000001';
const PAD_ID = '00000000-0000-4000-8000-000000000002';

describe('retiro-calc', () => {
  it('Cefalexina 5/4 desde 2026-09-17 produce liberaciones duales correctas', () => {
    const r = resolveRetiros({
      fecha: '2026-09-17',
      diasRetiroLeche: 5,
      diasRetiroCarne: 4,
    });
    expect(r.fechaUltimaAdministracion).toBe('2026-09-17');
    expect(r.fechaLiberacionLeche).toBe('2026-09-22');
    expect(r.fechaLiberacionCarne).toBe('2026-09-21');
  });

  it('Oxitetraciclina 7/28 e Ivermectina 28/35 calculan liberaciones distintas', () => {
    const oxi = resolveRetiros({
      fecha: '2026-09-17',
      diasRetiroLeche: 7,
      diasRetiroCarne: 28,
    });
    expect(oxi.fechaLiberacionLeche).toBe('2026-09-24');
    expect(oxi.fechaLiberacionCarne).toBe('2026-10-15');

    const iver = resolveRetiros({
      fecha: '2026-09-17',
      diasRetiroLeche: 28,
      diasRetiroCarne: 35,
    });
    expect(iver.fechaLiberacionLeche).toBe('2026-10-15');
    expect(iver.fechaLiberacionCarne).toBe('2026-10-22');
  });

  it('la liberación se calcula desde la última administración', () => {
    const r = resolveRetiros({
      fecha: '2026-09-10',
      fechaUltimaAdministracion: '2026-09-14',
      diasRetiroLeche: 7,
      diasRetiroCarne: 0,
    });
    expect(r.fechaLiberacionLeche).toBe('2026-09-21');
    expect(r.fechaLiberacionCarne).toBe('2026-09-14');
  });

  it('solapamiento usa la liberación más lejana (MAX)', () => {
    const estado = computeEstadoSanitario(
      ANIMAL_ID,
      [
        {
          id: 't1',
          farmaco: 'Cefalexina',
          fechaLiberacionLeche: '2026-09-22',
          fechaLiberacionCarne: '2026-09-21',
        },
        {
          id: 't2',
          farmaco: 'Oxitetraciclina',
          fechaAplicacion: '2026-09-17',
          fechaLiberacionLeche: '2026-09-30',
          fechaLiberacionCarne: '2026-10-15',
        },
      ],
      '2026-09-20',
    );
    expect(estado.enRetiro).toBe(true);
    expect(estado.liberacionLeche).toBe('2026-09-30');
    expect(estado.liberacionCarne).toBe('2026-10-15');
    expect(estado.tratamientoReferencia).toEqual({
      id: 't2',
      farmaco: 'Oxitetraciclina',
      fechaAplicacion: '2026-09-17',
    });
  });

  it('en la fecha exacta de liberación el animal queda apto', () => {
    const estado = computeEstadoSanitario(
      ANIMAL_ID,
      [
        {
          id: 't1',
          farmaco: 'Cefalexina',
          fechaLiberacionLeche: '2026-09-22',
          fechaLiberacionCarne: '2026-09-22',
        },
      ],
      '2026-09-22',
    );
    expect(estado.enRetiro).toBe(false);
    expect(estado.diasRestantesLeche).toBe(0);
    expect(estado.tratamientoReferencia).toBeNull();
  });

  it('hembra con solo retiro de carne queda en retiro de carne', () => {
    const estado = computeEstadoSanitario(
      ANIMAL_ID,
      [
        {
          id: 't1',
          farmaco: 'Oxitetraciclina',
          fechaLiberacionLeche: '2026-09-17',
          fechaLiberacionCarne: '2026-10-15',
        },
      ],
      '2026-09-20',
    );
    expect(estado.enRetiro).toBe(true);
    expect(estado.liberacionLeche).toBeNull();
    expect(estado.liberacionCarne).toBe('2026-10-15');
  });

  it('todayIsoDate usa la fecha civil de Costa Rica y no la del servidor', () => {
    // 01:00 UTC del 7 de octubre = 19:00 del 6 de octubre en Costa Rica.
    expect(todayIsoDate(new Date('2026-10-07T01:00:00Z'))).toBe('2026-10-06');
    expect(todayIsoDate(new Date('2026-10-07T07:00:00Z'))).toBe('2026-10-07');
  });

  describe('validarFechasTratamiento', () => {
    const hoy = '2026-10-06';

    it('rechaza fecha de aplicación futura', () => {
      expect(validarFechasTratamiento({ fecha: '2027-10-06', hoy })).toMatch(
        /posterior a hoy/,
      );
    });

    it('rechaza última administración anterior a la aplicación', () => {
      expect(
        validarFechasTratamiento({
          fecha: '2026-10-05',
          fechaUltimaAdministracion: '2026-10-01',
          hoy,
        }),
      ).toMatch(/anterior/);
    });

    it('rechaza protocolo de más de 60 días', () => {
      expect(
        validarFechasTratamiento({
          fecha: '2026-08-01',
          fechaUltimaAdministracion: '2026-10-01',
          hoy,
        }),
      ).toMatch(/60 días/);
    });

    it('acepta protocolo en curso con última administración futura', () => {
      expect(
        validarFechasTratamiento({
          fecha: hoy,
          fechaUltimaAdministracion: '2026-10-10',
          hoy,
        }),
      ).toBeNull();
    });
  });
});

describe('Validación de DTOs', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const base = {
    animalId: ANIMAL_ID,
    farmaco: 'Cefalexina',
    dosis: '1 jeringa',
    fecha: '2026-09-17',
    diagnostico: 'Mastitis',
    diasRetiroLeche: 5,
    diasRetiroCarne: 4,
  };

  it('acepta el payload dual completo', async () => {
    await expect(
      pipe.transform(base, { type: 'body', metatype: CreateTratamientoDto }),
    ).resolves.toBeInstanceOf(CreateTratamientoDto);
  });

  it('rechaza el campo legado diasRetiro sin retiros duales', async () => {
    await expect(
      pipe.transform(
        {
          animalId: ANIMAL_ID,
          farmaco: 'X',
          dosis: '1',
          fecha: '2026-09-17',
          diagnostico: 'Y',
          diasRetiro: 7,
        },
        { type: 'body', metatype: CreateTratamientoDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza días de retiro fuera de 0..365', async () => {
    await expect(
      pipe.transform(
        { ...base, diasRetiroCarne: 400 },
        { type: 'body', metatype: CreateTratamientoDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza fechas con hora', async () => {
    await expect(
      pipe.transform(
        { ...base, fecha: '2026-09-17T10:00:00Z' },
        { type: 'body', metatype: CreateTratamientoDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige farmaco cuando no hay medicamentoId', async () => {
    const { farmaco: _f, ...sinFarmaco } = base;
    void _f;
    await expect(
      pipe.transform(sinFarmaco, {
        type: 'body',
        metatype: CreateTratamientoDto,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { ...sinFarmaco, medicamentoId: MED_ID },
        { type: 'body', metatype: CreateTratamientoDto },
      ),
    ).resolves.toBeInstanceOf(CreateTratamientoDto);
  });

  it('anulación sin motivo es rechazada', async () => {
    await expect(
      pipe.transform(
        { motivo: '  ' },
        { type: 'body', metatype: AnularTratamientoDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TratamientosService', () => {
  const service = new TratamientosService();
  const findOne = vi.fn();
  const find = vi.fn();
  const create = vi.fn((_cls: unknown, data: object) => ({ ...data }));
  const save = vi.fn();
  const manager = {
    findOne,
    find,
    create,
    save,
    transaction: vi.fn((cb: (trx: unknown) => unknown) => cb(manager)),
  } as unknown as EntityManager;

  const animal = { id: ANIMAL_ID, tenantId: TENANT_ID, sexo: 'Hembra' };
  const toro = { ...animal, sexo: 'Macho' };
  let eventoSeq = 0;

  const datos = {
    farmaco: 'Cefalexina 200 Intramamaria',
    dosis: '1 jeringa',
    fecha: '2026-09-17',
    diagnostico: 'Mastitis clínica',
    diasRetiroLeche: 5,
    diasRetiroCarne: 4,
  };

  const detalleVigente = (
    id: string,
    liberacionLeche: string,
    liberacionCarne: string,
  ) => ({
    eventoId: id,
    productoNombre: `prod-${id}`,
    fechaLiberacionLeche: liberacionLeche,
    fechaLiberacionCarne: liberacionCarne,
    evento: {
      id,
      animalId: ANIMAL_ID,
      fechaEvento: '2026-09-17',
      animal: { areteInterno: 'A-1', nombre: 'Lola' },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    eventoSeq = 0;
    save.mockImplementation(async (cls: unknown, entity: object) =>
      cls === Evento && !(entity as { id?: string }).id
        ? { id: `ev-${++eventoSeq}`, ...entity }
        : entity,
    );
  });

  describe('create', () => {
    it('crea evento TRATAMIENTO con usuario y detalle con liberaciones duales', async () => {
      findOne.mockResolvedValueOnce(animal);

      const result = await service.create(
        TENANT_ID,
        USER_ID,
        { animalId: ANIMAL_ID, ...datos },
        manager,
      );

      expect(findOne).toHaveBeenCalledWith(Animal, {
        where: { id: ANIMAL_ID, tenantId: TENANT_ID },
      });
      expect(create).toHaveBeenCalledWith(
        Evento,
        expect.objectContaining({
          tenantId: TENANT_ID,
          animalId: ANIMAL_ID,
          tipo: 'TRATAMIENTO',
          fechaEvento: '2026-09-17',
          usuarioId: USER_ID,
          eventoCorrigeId: null,
        }),
      );
      expect(create).toHaveBeenCalledWith(
        EventoTratamiento,
        expect.objectContaining({
          eventoId: 'ev-1',
          medicamentoId: null,
          productoNombre: 'Cefalexina 200 Intramamaria',
          fechaUltimaAdministracion: '2026-09-17',
          fechaLiberacionLeche: '2026-09-22',
          fechaLiberacionCarne: '2026-09-21',
        }),
      );
      expect(result).toMatchObject({
        id: 'ev-1',
        usuarioId: USER_ID,
        farmaco: 'Cefalexina 200 Intramamaria',
        fechaLiberacionLeche: '2026-09-22',
      });
    });

    it('con medicamentoId guarda la FK y el nombre del catálogo', async () => {
      findOne
        .mockResolvedValueOnce(animal)
        .mockResolvedValueOnce({ id: MED_ID, nombreComercial: 'Oxitetraciclina LA' });

      await service.create(
        TENANT_ID,
        USER_ID,
        {
          animalId: ANIMAL_ID,
          ...datos,
          farmaco: 'ignorado',
          medicamentoId: MED_ID,
        },
        manager,
      );

      expect(findOne).toHaveBeenCalledWith(Medicamento, {
        where: { id: MED_ID, tenantId: TENANT_ID },
      });
      expect(create).toHaveBeenCalledWith(
        EventoTratamiento,
        expect.objectContaining({
          medicamentoId: MED_ID,
          productoNombre: 'Oxitetraciclina LA',
        }),
      );
    });

    it('medicamento de otro tenant responde 404 y no crea nada', async () => {
      findOne.mockResolvedValueOnce(animal).mockResolvedValueOnce(null);

      await expect(
        service.create(
          TENANT_ID,
          USER_ID,
          { animalId: ANIMAL_ID, ...datos, medicamentoId: MED_ID },
          manager,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(save).not.toHaveBeenCalled();
    });

    it('animal inexistente lanza NotFoundException', async () => {
      findOne.mockResolvedValueOnce(null);
      await expect(
        service.create(
          TENANT_ID,
          USER_ID,
          { animalId: ANIMAL_ID, ...datos },
          manager,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('fecha futura responde 400', async () => {
      findOne.mockResolvedValueOnce(animal);
      await expect(
        service.create(
          TENANT_ID,
          USER_ID,
          { animalId: ANIMAL_ID, ...datos, fecha: '2099-01-01' },
          manager,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save).not.toHaveBeenCalled();
    });

    it('a un macho no se le puede registrar mastitis en texto libre (400)', async () => {
      findOne.mockResolvedValueOnce(toro);
      await expect(
        service.create(
          TENANT_ID,
          USER_ID,
          { animalId: ANIMAL_ID, ...datos, farmaco: 'Penicilina' },
          manager,
        ),
      ).rejects.toThrow("El diagnóstico 'Mastitis clínica' solo aplica a hembras.");
      expect(save).not.toHaveBeenCalled();
    });

    it('a un macho no se le puede registrar un padecimiento de categoría Reproductivo (400)', async () => {
      findOne
        .mockResolvedValueOnce(toro)
        .mockResolvedValueOnce({ id: PAD_ID, nombre: 'Retención placentaria', categoria: 'Reproductivo' });
      const { diagnostico: _omitido, ...sinDiagnostico } = datos;
      await expect(
        service.create(
          TENANT_ID,
          USER_ID,
          { animalId: ANIMAL_ID, ...sinDiagnostico, farmaco: 'Penicilina', padecimientoId: PAD_ID },
          manager,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save).not.toHaveBeenCalled();
    });

    it('a un macho no se le puede aplicar un medicamento intramamario (400)', async () => {
      findOne
        .mockResolvedValueOnce(toro)
        .mockResolvedValueOnce({ id: MED_ID, nombreComercial: 'Cefalexina', viaAdministracion: 'Intramamaria' });
      await expect(
        service.create(
          TENANT_ID,
          USER_ID,
          { animalId: ANIMAL_ID, ...datos, diagnostico: 'Neumonía', medicamentoId: MED_ID },
          manager,
        ),
      ).rejects.toThrow('La vía intramamaria solo aplica a hembras.');
    });

    it('a un macho sí se le registra un padecimiento de ambos sexos', async () => {
      findOne.mockResolvedValueOnce(toro);
      await service.create(
        TENANT_ID,
        USER_ID,
        { animalId: ANIMAL_ID, ...datos, farmaco: 'Ivermectina 1%', diagnostico: 'Parasitosis interna' },
        manager,
      );
      expect(save).toHaveBeenCalledTimes(2);
    });

    it('protocolo en curso calcula desde la última administración', async () => {
      findOne.mockResolvedValueOnce(animal);
      const hoy = todayIsoDate();
      const ultima = addCalendarDays(hoy, 4);

      await service.create(
        TENANT_ID,
        USER_ID,
        {
          animalId: ANIMAL_ID,
          ...datos,
          fecha: hoy,
          fechaUltimaAdministracion: ultima,
        },
        manager,
      );

      expect(create).toHaveBeenCalledWith(
        EventoTratamiento,
        expect.objectContaining({
          fechaUltimaAdministracion: ultima,
          fechaLiberacionLeche: addCalendarDays(ultima, 5),
        }),
      );
    });
  });

  describe('consultas', () => {
    it('findAllByAnimal filtra vigentes del tenant y ordena por fecha desc', async () => {
      findOne.mockResolvedValueOnce(animal);
      find.mockResolvedValueOnce([detalleVigente('e1', '2026-09-22', '2026-09-21')]);

      const result = await service.findAllByAnimal(TENANT_ID, ANIMAL_ID, manager);

      expect(find).toHaveBeenCalledWith(EventoTratamiento, {
        relations: { evento: true },
        where: {
          evento: {
            tenantId: TENANT_ID,
            animalId: ANIMAL_ID,
            tipo: 'TRATAMIENTO',
            revertido: false,
          },
        },
        order: { evento: { fechaEvento: 'DESC', fechaRegistro: 'DESC' } },
      });
      expect(result[0]).toMatchObject({ id: 'e1', farmaco: 'prod-e1' });
    });

    it('findAllByAnimal de animal de otro tenant responde 404', async () => {
      findOne.mockResolvedValueOnce(null);
      await expect(
        service.findAllByAnimal(TENANT_ID, ANIMAL_ID, manager),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(find).not.toHaveBeenCalled();
    });

    it('getEstadoSanitario deriva enRetiro solo con vigentes', async () => {
      findOne.mockResolvedValueOnce(animal);
      find.mockResolvedValueOnce([detalleVigente('e1', '2026-09-22', '2026-09-21')]);

      const estado = await service.getEstadoSanitario(
        TENANT_ID,
        ANIMAL_ID,
        manager,
        '2026-09-18',
      );

      expect(estado.enRetiro).toBe(true);
      expect(estado.liberacionLeche).toBe('2026-09-22');
      expect(estado.diasRestantesLeche).toBe(4);
    });

    it('getEstadoSanitario con tratamiento anulado (no vigente) queda apto', async () => {
      findOne.mockResolvedValueOnce(animal);
      find.mockResolvedValueOnce([]);

      const estado = await service.getEstadoSanitario(
        TENANT_ID,
        ANIMAL_ID,
        manager,
        '2026-09-18',
      );
      expect(estado.enRetiro).toBe(false);
    });

    it('getEstadoSanitario de animal inexistente responde 404 en vez de apto', async () => {
      findOne.mockResolvedValueOnce(null);
      await expect(
        service.getEstadoSanitario(TENANT_ID, ANIMAL_ID, manager, '2026-09-18'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('getRetirosActivos agrupa por animal y omite los que vencen en la fecha', async () => {
      const otro = {
        ...detalleVigente('e3', '2026-09-30', '2026-10-15'),
        evento: {
          id: 'e3',
          animalId: 'animal-2',
          fechaEvento: '2026-09-17',
          animal: { areteInterno: 'B-2', nombre: 'Mora' },
        },
      };
      const venceHoy = {
        ...detalleVigente('e4', '2026-09-20', '2026-09-20'),
        evento: {
          id: 'e4',
          animalId: 'animal-3',
          fechaEvento: '2026-09-15',
          animal: { areteInterno: 'C-3', nombre: 'Pinta' },
        },
      };
      find.mockResolvedValueOnce([
        detalleVigente('e1', '2026-09-22', '2026-09-21'),
        detalleVigente('e2', '2026-09-25', '2026-09-19'),
        otro,
        venceHoy,
      ]);

      const lista = await service.getRetirosActivos(TENANT_ID, manager, '2026-09-20');

      expect(lista).toHaveLength(2);
      expect(lista[0]).toMatchObject({
        animalId: ANIMAL_ID,
        arete: 'A-1',
        fechaLiberacionLeche: '2026-09-25',
        fechaLiberacionCarne: '2026-09-21',
        diasRestantesLeche: 5,
        diasRestantesCarne: 1,
        tratamientoReferencia: { id: 'e2', farmaco: 'prod-e2' },
      });
      expect(lista[1]).toMatchObject({ animalId: 'animal-2', arete: 'B-2' });
    });
  });

  describe('corrección y anulación', () => {
    const original = () => ({
      id: 'orig-1',
      tenantId: TENANT_ID,
      animalId: ANIMAL_ID,
      tipo: 'TRATAMIENTO',
      revertido: false,
    });

    it('corregir revierte el original y crea un evento que lo referencia', async () => {
      const orig = original();
      findOne
        .mockResolvedValueOnce(orig)
        .mockResolvedValueOnce({ eventoId: 'orig-1' })
        .mockResolvedValueOnce(animal);

      const result = await service.corregir(
        TENANT_ID,
        USER_ID,
        'orig-1',
        { ...datos, diasRetiroCarne: 28 },
        manager,
      );

      expect(findOne).toHaveBeenNthCalledWith(1, Evento, {
        where: { id: 'orig-1', tenantId: TENANT_ID, tipo: 'TRATAMIENTO' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(save).toHaveBeenCalledWith(
        Evento,
        expect.objectContaining({ id: 'orig-1', revertido: true }),
      );
      expect(create).toHaveBeenCalledWith(
        Evento,
        expect.objectContaining({ eventoCorrigeId: 'orig-1', usuarioId: USER_ID }),
      );
      expect(result).toMatchObject({
        eventoCorrigeId: 'orig-1',
        diasRetiroCarne: 28,
        fechaLiberacionCarne: '2026-10-15',
      });
    });

    it('corregir un tratamiento ya revertido responde 409 sin crear eventos', async () => {
      findOne
        .mockResolvedValueOnce({ ...original(), revertido: true })
        .mockResolvedValueOnce({ eventoId: 'orig-1' });

      await expect(
        service.corregir(TENANT_ID, USER_ID, 'orig-1', datos, manager),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(save).not.toHaveBeenCalled();
    });

    it('corregir un tratamiento inexistente o de otro tenant responde 404', async () => {
      findOne.mockResolvedValueOnce(null);
      await expect(
        service.corregir(TENANT_ID, USER_ID, 'orig-1', datos, manager),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('la corrección es atómica: si falla el evento nuevo, la transacción aborta', async () => {
      findOne
        .mockResolvedValueOnce(original())
        .mockResolvedValueOnce({ eventoId: 'orig-1' })
        .mockResolvedValueOnce(animal);
      save
        .mockImplementationOnce(async (_cls: unknown, e: object) => e)
        .mockRejectedValueOnce(new Error('fallo de base'));
      await expect(
        service.corregir(TENANT_ID, USER_ID, 'orig-1', datos, manager),
      ).rejects.toThrow('fallo de base');
      // Revertir el original y crear el corrector ocurren en la misma transacción;
      // el rollback real se verifica en tratamientos-rls.integration.spec.ts.
      expect(manager.transaction).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(2);
    });

    it('anular revierte el original y registra un evento con motivo y usuario', async () => {
      findOne.mockResolvedValueOnce(original()).mockResolvedValueOnce({ eventoId: 'orig-1' });

      const result = await service.anular(
        TENANT_ID,
        USER_ID,
        'orig-1',
        { motivo: 'registrado al animal equivocado' },
        manager,
      );

      expect(save).toHaveBeenCalledWith(
        Evento,
        expect.objectContaining({ id: 'orig-1', revertido: true }),
      );
      expect(create).toHaveBeenCalledWith(
        Evento,
        expect.objectContaining({
          tipo: 'TRATAMIENTO',
          eventoCorrigeId: 'orig-1',
          usuarioId: USER_ID,
          notas: 'registrado al animal equivocado',
        }),
      );
      expect(create).not.toHaveBeenCalledWith(EventoTratamiento, expect.anything());
      expect(result).toEqual({
        id: 'orig-1',
        eventoAnulacionId: 'ev-1',
        motivo: 'registrado al animal equivocado',
      });
    });

    it('un evento de anulación (sin detalle) no se puede corregir', async () => {
      findOne.mockResolvedValueOnce(original()).mockResolvedValueOnce(null);
      await expect(
        service.corregir(TENANT_ID, USER_ID, 'orig-1', datos, manager),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
