import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { PesajesService } from './pesajes.service.js';
import { Pesaje } from './entities/pesaje.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { CreatePesajeDto } from './dto/create-pesaje.dto.js';
import { addCalendarDays, todayIsoDate } from '../tratamientos/retiro-calc.js';

const TENANT = 'tenant-1';
const ANIMAL_ID = '00000000-0000-4000-8000-000000000010';
const hoy = todayIsoDate();

describe('Validación del DTO de pesaje', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validar = (body: object) => pipe.transform(body, { type: 'body', metatype: CreatePesajeDto });
  const base = { animalId: ANIMAL_ID, fecha: '2026-10-01', pesoActualKg: 485 };

  it('acepta solo peso', async () => {
    await expect(validar(base)).resolves.toBeInstanceOf(CreatePesajeDto);
  });

  it('rechaza los campos de leche', async () => {
    await expect(validar({ ...base, lecheMananaL: 8 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar({ ...base, lecheTardeL: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige un peso mayor que 0 y hasta 2000 kg', async () => {
    const { pesoActualKg: _p, ...sinPeso } = base;
    void _p;
    await expect(validar(sinPeso)).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar({ ...base, pesoActualKg: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar({ ...base, pesoActualKg: 2500 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PesajesService', () => {
  const service = new PesajesService();
  let animal: Partial<Animal> | null;
  let posterior: Partial<Pesaje> | null;
  const findOne = vi.fn();
  const find = vi.fn();
  const save = vi.fn(async (entity: object) => entity);
  const manager = {
    findOne,
    find,
    save,
    create: vi.fn((_cls: unknown, data: object) => ({ ...data })),
  } as unknown as EntityManager;

  beforeEach(() => {
    vi.clearAllMocks();
    animal = { id: ANIMAL_ID, tenantId: TENANT, sexo: 'Macho', pesoActualKg: 500 };
    posterior = null;
    findOne.mockImplementation(async (cls: unknown) => (cls === Animal ? animal : posterior));
  });

  it('pesa un toro y sincroniza el peso actual', async () => {
    await service.create(TENANT, { animalId: ANIMAL_ID, fecha: hoy, pesoActualKg: 650 }, manager);
    expect(animal?.pesoActualKg).toBe(650);
  });

  it('un pesaje retroactivo no pisa el peso actual', async () => {
    posterior = { id: 'p-nuevo', fecha: hoy };
    await service.create(
      TENANT,
      { animalId: ANIMAL_ID, fecha: addCalendarDays(hoy, -15), pesoActualKg: 470 },
      manager,
    );
    expect(animal?.pesoActualKg).toBe(500);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('rechaza una fecha futura', async () => {
    await expect(
      service.create(TENANT, { animalId: ANIMAL_ID, fecha: addCalendarDays(hoy, 1), pesoActualKg: 500 }, manager),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el historial de un animal de otra finca responde 404', async () => {
    animal = null;
    await expect(service.findAllByAnimal(TENANT, ANIMAL_ID, manager)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(find).not.toHaveBeenCalled();
  });
});
