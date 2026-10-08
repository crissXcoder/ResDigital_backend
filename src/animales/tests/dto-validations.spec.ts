import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateAnimalDto } from '../dto/create-animal.dto.js';
import { BajaAnimalDto } from '../dto/baja-animal.dto.js';

describe('DTOs de Animales - Validaciones de Enums, Límites y Fechas (HATO-T004)', () => {
  function crearCreateDtoValido(): Record<string, any> {
    return {
      nombre: 'Esperanza',
      areteInterno: '101',
      sexo: 'Hembra',
      razaId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      categoria: 'Vaca',
      fechaNacimiento: '2024-01-15',
      pesoActualKg: 450,
      origen: 'Finca',
    };
  }

  describe('CreateAnimalDto', () => {
    it('pasa con datos válidos', async () => {
      const dto = plainToInstance(CreateAnimalDto, crearCreateDtoValido());
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('rechaza origen fuera del catálogo permitido', async () => {
      const datos = { ...crearCreateDtoValido(), origen: 'Subasta_Invalida' };
      const dto = plainToInstance(CreateAnimalDto, datos);
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'origen')).toBe(true);
    });

    it('acepta origenes permitidos ("Finca", "Externa")', async () => {
      for (const origen of ['Finca', 'Externa'] as const) {
        const dto = plainToInstance(CreateAnimalDto, {
          ...crearCreateDtoValido(),
          origen,
        });
        const errors = await validate(dto);
        expect(errors.some((e) => e.property === 'origen')).toBe(false);
      }
    });

    it('rechaza metodoCompra inválido', async () => {
      const datos = { ...crearCreateDtoValido(), metodoCompra: 'Bitcoin' };
      const dto = plainToInstance(CreateAnimalDto, datos);
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'metodoCompra')).toBe(true);
    });

    it('acepta metodos de compra válidos', async () => {
      for (const metodo of ['Sinpe', 'Depósito', 'Efectivo', 'Combinado'] as const) {
        const dto = plainToInstance(CreateAnimalDto, {
          ...crearCreateDtoValido(),
          metodoCompra: metodo,
        });
        const errors = await validate(dto);
        expect(errors.some((e) => e.property === 'metodoCompra')).toBe(false);
      }
    });

    it('rechaza peso actual negativo', async () => {
      const datos = { ...crearCreateDtoValido(), pesoActualKg: -25 };
      const dto = plainToInstance(CreateAnimalDto, datos);
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'pesoActualKg')).toBe(true);
    });

    it('acepta peso actual cero o positivo', async () => {
      const dtoCero = plainToInstance(CreateAnimalDto, {
        ...crearCreateDtoValido(),
        pesoActualKg: 0,
      });
      const errorsCero = await validate(dtoCero);
      expect(errorsCero.some((e) => e.property === 'pesoActualKg')).toBe(false);
    });

    it('rechaza valor de compra negativo', async () => {
      const datos = { ...crearCreateDtoValido(), valorCompraCrc: -50000 };
      const dto = plainToInstance(CreateAnimalDto, datos);
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'valorCompraCrc')).toBe(true);
    });

    it('rechaza fecha de nacimiento futura', async () => {
      const datos = { ...crearCreateDtoValido(), fechaNacimiento: '2099-12-31' };
      const dto = plainToInstance(CreateAnimalDto, datos);
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'fechaNacimiento')).toBe(true);
    });

    it('rechaza fecha de compra futura', async () => {
      const datos = { ...crearCreateDtoValido(), fechaCompra: '2099-12-31' };
      const dto = plainToInstance(CreateAnimalDto, datos);
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'fechaCompra')).toBe(true);
    });
  });

  describe('BajaAnimalDto', () => {
    it('pasa con datos válidos', async () => {
      const dto = plainToInstance(BajaAnimalDto, {
        tipoBaja: 'Venta Comercial',
        fechaBaja: '2026-01-10',
        precioVentaCrc: 350000,
        pesoFinalKg: 480,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('rechaza tipoBaja fuera del enum', async () => {
      const dto = plainToInstance(BajaAnimalDto, {
        tipoBaja: 'Regalado_A_Vecino',
        fechaBaja: '2026-01-10',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'tipoBaja')).toBe(true);
    });

    it('rechaza fechaBaja futura', async () => {
      const dto = plainToInstance(BajaAnimalDto, {
        tipoBaja: 'Fallecimiento',
        fechaBaja: '2099-01-01',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'fechaBaja')).toBe(true);
    });

    it('rechaza precioVentaCrc o pesoFinalKg negativos', async () => {
      const dto = plainToInstance(BajaAnimalDto, {
        tipoBaja: 'Venta Comercial',
        fechaBaja: '2026-01-10',
        precioVentaCrc: -1000,
        pesoFinalKg: -5,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'precioVentaCrc')).toBe(true);
      expect(errors.some((e) => e.property === 'pesoFinalKg')).toBe(true);
    });
  });
});
