import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { isValidCivilDate } from '../dto/validators/fecha-evento.validator.js';
import { RegistrarServicioDto } from '../dto/registrar-servicio.dto.js';
import { RegistrarDiagnosticoDto } from '../dto/registrar-diagnostico.dto.js';
import { RegistrarSecadoDto } from '../dto/registrar-secado.dto.js';
import { RegistrarPartoDto } from '../dto/registrar-parto.dto.js';

describe('isValidCivilDate', () => {
  it.each([
    ['2024-02-29', true],
    ['2000-02-29', true],
    ['2026-02-28', true],
    ['2026-02-29', false],
    ['1900-02-29', false],
    ['2026-04-31', false],
    ['2026-13-01', false],
    ['2026-00-10', false],
    ['0000-01-01', false],
    ['2026-1-01', false],
    [null, false],
    [42, false],
  ])('valida %s => %s', (value, expected) => {
    expect(isValidCivilDate(value)).toBe(expected);
  });
});

describe('EsFechaDeEvento en los DTOs reproductivos', () => {
  it.each([
    ['servicio', RegistrarServicioDto],
    ['diagnóstico', RegistrarDiagnosticoDto],
    ['secado', RegistrarSecadoDto],
    ['parto', RegistrarPartoDto],
  ])('rechaza un día imposible en %s', async (_name, Dto) => {
    const dto = Object.assign(new Dto(), { fechaEvento: '2026-02-29' });
    const errors = await validate(dto);
    expect(errors.find((error) => error.property === 'fechaEvento')).toBeDefined();
  });

  it('acepta la misma fecha de servicio y diagnóstico en el calendario', async () => {
    const dto = Object.assign(new RegistrarDiagnosticoDto(), {
      fechaEvento: '2026-03-01',
    });
    const errors = await validate(dto);
    expect(errors.find((error) => error.property === 'fechaEvento')).toBeUndefined();
  });
});
