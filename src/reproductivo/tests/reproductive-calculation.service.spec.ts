import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ReproductiveCalculationService } from '../services/reproductive-calculation.service.js';

describe('ReproductiveCalculationService (Cálculo Puro de Hitos Veterinarios)', () => {
  let service: ReproductiveCalculationService;

  beforeEach(() => {
    service = new ReproductiveCalculationService();
  });

  describe('Cálculo por Razas Oficiales (Reglas-de-Negocio-Ganaderas.md)', () => {
    const fechaServicio = '2026-03-01';

    it('Caso 1: Holstein (281 días) calcula FPP, palpación, secado y avisos exactos', () => {
      const diasGestacion = 281;
      const hitos = service.calcularHitos(fechaServicio, diasGestacion);

      // Palpación = fechaServicio + 40 días = 2026-04-10
      expect(hitos.palpacionFecha).toBe('2026-04-10');

      // FPP = 2026-03-01 + 281 días = 2026-12-07
      expect(hitos.fpp).toBe('2026-12-07');

      // Secado = FPP - 60 días = 2026-10-08
      expect(hitos.secadoFecha).toBe('2026-10-08');

      // Aviso parto = FPP - 15 días = 2026-11-22
      expect(hitos.avisoPartoFecha).toBe('2026-11-22');

      // Aviso parto urgente = FPP - 3 días = 2026-12-04
      expect(hitos.avisoPartoUrgenteFecha).toBe('2026-12-04');
    });

    it('Caso 2: Brahman (293 días) calcula FPP, palpación, secado y avisos exactos', () => {
      const diasGestacion = 293;
      const hitos = service.calcularHitos(fechaServicio, diasGestacion);

      // Palpación = fechaServicio + 40 días = 2026-04-10
      expect(hitos.palpacionFecha).toBe('2026-04-10');

      // FPP = 2026-03-01 + 293 días = 2026-12-19
      expect(hitos.fpp).toBe('2026-12-19');

      // Secado = FPP - 60 días = 2026-10-20
      expect(hitos.secadoFecha).toBe('2026-10-20');

      // Aviso parto = FPP - 15 días = 2026-12-04
      expect(hitos.avisoPartoFecha).toBe('2026-12-04');

      // Aviso parto urgente = FPP - 3 días = 2026-12-16
      expect(hitos.avisoPartoUrgenteFecha).toBe('2026-12-16');
    });

    it('Caso 3: Jersey (279 días) calcula FPP, palpación, secado y avisos exactos', () => {
      const diasGestacion = 279;
      const hitos = service.calcularHitos(fechaServicio, diasGestacion);

      // Palpación = fechaServicio + 40 días = 2026-04-10
      expect(hitos.palpacionFecha).toBe('2026-04-10');

      // FPP = 2026-03-01 + 279 días = 2026-12-05
      expect(hitos.fpp).toBe('2026-12-05');

      // Secado = FPP - 60 días = 2026-10-06
      expect(hitos.secadoFecha).toBe('2026-10-06');

      // Aviso parto = FPP - 15 días = 2026-11-20
      expect(hitos.avisoPartoFecha).toBe('2026-11-20');

      // Aviso parto urgente = FPP - 3 días = 2026-12-02
      expect(hitos.avisoPartoUrgenteFecha).toBe('2026-12-02');
    });

    it('Caso 4: Girolando (290 días) calcula FPP, palpación, secado y avisos exactos', () => {
      const diasGestacion = 290;
      const hitos = service.calcularHitos(fechaServicio, diasGestacion);

      // Palpación = fechaServicio + 40 días = 2026-04-10
      expect(hitos.palpacionFecha).toBe('2026-04-10');

      // FPP = 2026-03-01 + 290 días = 2026-12-16
      expect(hitos.fpp).toBe('2026-12-16');

      // Secado = FPP - 60 días = 2026-10-17
      expect(hitos.secadoFecha).toBe('2026-10-17');

      // Aviso parto = FPP - 15 días = 2026-12-01
      expect(hitos.avisoPartoFecha).toBe('2026-12-01');

      // Aviso parto urgente = FPP - 3 días = 2026-12-13
      expect(hitos.avisoPartoUrgenteFecha).toBe('2026-12-13');
    });

    it('Diferencia entre Brahman y Jersey es exactamente 14 días en FPP', () => {
      const hitosBrahman = service.calcularHitos(fechaServicio, 293);
      const hitosJersey = service.calcularHitos(fechaServicio, 279);

      const diffDias =
        (new Date(hitosBrahman.fpp).getTime() -
          new Date(hitosJersey.fpp).getTime()) /
        (1000 * 60 * 60 * 24);

      expect(diffDias).toBe(14);
    });
  });

  describe('Validaciones y Robustez (Cero defaults quemados)', () => {
    it('Acepta objetos Date válidos en UTC sin desvío de fecha', () => {
      const fechaDate = new Date('2026-05-15T00:00:00.000Z');
      const hitos = service.calcularHitos(fechaDate, 290);

      expect(hitos.palpacionFecha).toBe('2026-06-24');
      expect(hitos.fpp).toBe('2027-03-01');
    });

    it('Rechaza explícitamente con BadRequestException si diasGestacion es nulo o indefinido', () => {
      expect(() => service.calcularHitos('2026-01-01', null as any)).toThrow(
        BadRequestException,
      );
      expect(() =>
        service.calcularHitos('2026-01-01', undefined as any),
      ).toThrow(BadRequestException);
    });

    it('Rechaza explícitamente con BadRequestException si diasGestacion es <= 0 o NaN', () => {
      expect(() => service.calcularHitos('2026-01-01', 0)).toThrow(
        BadRequestException,
      );
      expect(() => service.calcularHitos('2026-01-01', -5)).toThrow(
        BadRequestException,
      );
      expect(() => service.calcularHitos('2026-01-01', Number.NaN)).toThrow(
        BadRequestException,
      );
    });

    it('Rechaza fechas inválidas con BadRequestException', () => {
      expect(() => service.calcularHitos('fecha-invalida', 281)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('Casos límite de aritmética de calendario', () => {
    it('cruza correctamente el 29 de febrero de un año bisiesto', () => {
      // 2028 es bisiesto. Del 1 de febrero + 29 días se llega al 1 de marzo,
      // no al 29 de febrero, justamente porque febrero tiene 29 ese año.
      const hitos = service.calcularHitos('2028-02-01', 29);
      expect(hitos.fpp).toBe('2028-03-01');
    });

    it('cruza correctamente el cambio de año', () => {
      const hitos = service.calcularHitos('2026-12-15', 40);
      expect(hitos.fpp).toBe('2027-01-24');
    });

    it('la fecha de palpación cae dentro de la ventana 35-45 días que define Reglas-de-Negocio-Ganaderas.md', () => {
      const fechaServicio = '2026-03-01';
      const hitos = service.calcularHitos(fechaServicio, 281);

      const dias =
        (new Date(hitos.palpacionFecha).getTime() -
          new Date(fechaServicio).getTime()) /
        86400000;

      expect(dias).toBeGreaterThanOrEqual(35);
      expect(dias).toBeLessThanOrEqual(45);
    });

    it('el secado cae exactamente 60 días antes de la FPP, y los avisos a 15 y 3 días', () => {
      const hitos = service.calcularHitos('2026-03-01', 281);
      const dias = (desde: string, hasta: string) =>
        (new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000;

      expect(dias(hitos.secadoFecha, hitos.fpp)).toBe(60);
      expect(dias(hitos.avisoPartoFecha, hitos.fpp)).toBe(15);
      expect(dias(hitos.avisoPartoUrgenteFecha, hitos.fpp)).toBe(3);
    });

    it('CASO LÍMITE: con una gestación menor a 60 días el secado queda antes del servicio, y aun así se calcula sin romper', () => {
      const hitos = service.calcularHitos('2026-03-01', 30);
      expect(hitos.fpp).toBe('2026-03-31');
      expect(hitos.secadoFecha).toBe('2026-01-30'); // FPP - 60, anterior al servicio
    });
  });

  describe('hoyLocal: la fecha "de hoy" es la de la finca, no la de UTC', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('caso normal: a mediodía UTC coincide con el día en Costa Rica', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
      expect(service.hoyLocal()).toBe('2026-09-17');
    });

    it('CASO LÍMITE: a las 23:30 UTC todavía es el día anterior en Costa Rica (UTC-6)', () => {
      // Este es el bug que se corrigió: usar toISOString() daba '2026-09-18',
      // así que durante seis horas de cada día todos los diasRestantes salían
      // corridos en uno.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-17T23:30:00Z'));
      expect(service.hoyLocal()).toBe('2026-09-17');
      expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-17');
    });

    it('CASO LÍMITE: a las 05:30 UTC sigue siendo el día anterior en Costa Rica', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-18T05:30:00Z'));
      expect(service.hoyLocal()).toBe('2026-09-17');
      // En UTC ya es el 18: ahí está la diferencia de seis horas.
      expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-18');
    });
  });
});
