import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegistrarPartoDto } from '../dto/registrar-parto.dto.js';

const CRIA_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('RegistrarPartoDto — modalidades de cría', () => {
  it('pasa con solo criaAnimalId', async () => {
    const dto = plainToInstance(RegistrarPartoDto, {
      fechaEvento: '2026-09-10',
      criaAnimalId: CRIA_ID,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('pasa con solo nuevaCria', async () => {
    const dto = plainToInstance(RegistrarPartoDto, {
      fechaEvento: '2026-09-10',
      nuevaCria: { areteInterno: 'CR-2026-001' },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('pasa omitiendo ambos campos de cría', async () => {
    const dto = plainToInstance(RegistrarPartoDto, {
      fechaEvento: '2026-09-10',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza criaAnimalId y nuevaCria a la vez', async () => {
    const dto = plainToInstance(RegistrarPartoDto, {
      fechaEvento: '2026-09-10',
      criaAnimalId: CRIA_ID,
      nuevaCria: { areteInterno: 'CR-01' },
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'criaAnimalId')).toBe(true);
  });
});
