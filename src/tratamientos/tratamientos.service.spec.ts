import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { EntityManager } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { TratamientosService } from './tratamientos.service.js';
import { Tratamiento } from './entities/tratamiento.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import {
  addCalendarDays,
  computeEstadoSanitario,
  resolveRetiros,
} from './retiro-calc.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ANIMAL_ID = '00000000-0000-0000-0000-000000000010';

describe('retiro-calc', () => {
  it('Cefalexina 5/4 desde 2026-09-17 produce liberaciones duales correctas', () => {
    const r = resolveRetiros({
      fecha: '2026-09-17',
      diasRetiroLeche: 5,
      diasRetiroCarne: 4,
    });
    expect(r.fechaLiberacionLeche).toBe('2026-09-22');
    expect(r.fechaLiberacionCarne).toBe('2026-09-21');
    expect(r.diasRetiro).toBe(5);
  });

  it('fallback legado diasRetiro aplica a ambos lados', () => {
    const r = resolveRetiros({ fecha: '2026-09-17', diasRetiro: 7 });
    expect(r.diasRetiroLeche).toBe(7);
    expect(r.diasRetiroCarne).toBe(7);
    expect(r.fechaLiberacionLeche).toBe(addCalendarDays('2026-09-17', 7));
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
          fechaLiberacionLeche: '2026-09-30',
          fechaLiberacionCarne: '2026-10-15',
        },
      ],
      '2026-09-20',
    );
    expect(estado.enRetiro).toBe(true);
    expect(estado.liberacionLeche).toBe('2026-09-30');
    expect(estado.liberacionCarne).toBe('2026-10-15');
    expect(estado.tratamientoReferencia?.farmaco).toBe('Oxitetraciclina');
  });

  it('tras pasar las fechas de liberación el animal queda apto', () => {
    const estado = computeEstadoSanitario(
      ANIMAL_ID,
      [
        {
          id: 't1',
          farmaco: 'Cefalexina',
          fechaLiberacionLeche: '2026-09-22',
          fechaLiberacionCarne: '2026-09-21',
        },
      ],
      '2026-09-23',
    );
    expect(estado.enRetiro).toBe(false);
    expect(estado.liberacionLeche).toBeNull();
    expect(estado.liberacionCarne).toBeNull();
    expect(estado.diasRestantesLeche).toBe(0);
    expect(estado.tratamientoReferencia).toBeNull();
  });
});

describe('TratamientosService', () => {
  let service: TratamientosService;
  const findOne = vi.fn();
  const find = vi.fn();
  const create = vi.fn((_cls: unknown, data: unknown) => data);
  const save = vi.fn(async (entity: unknown) => ({
    id: 'tr-1',
    ...(entity as object),
  }));
  const merge = vi.fn();

  const manager = {
    findOne,
    find,
    create,
    save,
    merge,
  } as unknown as EntityManager;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TratamientosService],
    }).compile();
    service = module.get(TratamientosService);
    vi.clearAllMocks();
  });

  it('create con Cefalexina 5/4 persiste liberaciones duales', async () => {
    findOne.mockResolvedValue({ id: ANIMAL_ID, tenantId: TENANT_ID });

    const result = await service.create(
      TENANT_ID,
      {
        animalId: ANIMAL_ID,
        farmaco: 'Cefalexina 200 Intramamaria',
        dosis: '1 jeringa',
        fecha: '2026-09-17',
        diagnostico: 'Mastitis clínica',
        diasRetiroLeche: 5,
        diasRetiroCarne: 4,
      },
      manager,
    );

    expect(findOne).toHaveBeenCalledWith(Animal, {
      where: { id: ANIMAL_ID, tenantId: TENANT_ID },
    });
    expect(create).toHaveBeenCalledWith(
      Tratamiento,
      expect.objectContaining({
        diasRetiroLeche: 5,
        diasRetiroCarne: 4,
        diasRetiro: 5,
        fechaLiberacionLeche: '2026-09-22',
        fechaLiberacionCarne: '2026-09-21',
      }),
    );
    expect(result.fechaLiberacionLeche).toBe('2026-09-22');
  });

  it('create con animal inexistente lanza NotFoundException', async () => {
    findOne.mockResolvedValue(null);
    await expect(
      service.create(
        TENANT_ID,
        {
          animalId: ANIMAL_ID,
          farmaco: 'X',
          dosis: '1',
          fecha: '2026-09-17',
          diagnostico: 'Y',
          diasRetiro: 1,
        },
        manager,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findAllByAnimal ordena por fecha desc y expone campos duales', async () => {
    const rows = [
      {
        id: 't1',
        diasRetiroLeche: 5,
        diasRetiroCarne: 4,
        fechaLiberacionLeche: '2026-09-22',
        fechaLiberacionCarne: '2026-09-21',
      },
    ];
    find.mockResolvedValue(rows);

    const result = await service.findAllByAnimal(TENANT_ID, ANIMAL_ID, manager);

    expect(find).toHaveBeenCalledWith(Tratamiento, {
      where: { tenantId: TENANT_ID, animalId: ANIMAL_ID },
      order: { fecha: 'DESC', createdAt: 'DESC' },
    });
    expect(result[0].diasRetiroLeche).toBe(5);
    expect(result[0].fechaLiberacionLeche).toBe('2026-09-22');
  });

  it('getEstadoSanitario deriva enRetiro desde tratamientos vigentes', async () => {
    find.mockResolvedValue([
      {
        id: 't1',
        farmaco: 'Cefalexina',
        fechaLiberacionLeche: '2026-09-22',
        fechaLiberacionCarne: '2026-09-21',
      },
    ]);

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
});
