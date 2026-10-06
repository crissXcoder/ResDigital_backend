import { applyDecorators } from '@nestjs/common';
import {
  IsNotEmpty,
  Matches,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { hoyEnZona } from '../../services/reproductive-calculation.service.js';

/**
 * Valida que una fecha de evento no esté en el futuro.
 *
 * Los eventos reproductivos registran algo que ya pasó en la finca. Sin esta
 * validación se podía registrar un servicio con fecha 2099 y generar una FPP
 * para el siglo siguiente, que además contaminaba el calendario del Dashboard.
 *
 * La comparación usa el día en la zona horaria de la finca, no en UTC: si no,
 * durante las últimas seis horas de cada día se rechazaría una fecha de hoy
 * perfectamente válida.
 */
export function EsFechaNoFutura(
  options?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'esFechaNoFutura',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          return value.slice(0, 10) <= hoyEnZona();
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} no puede ser una fecha futura: los eventos se registran después de que ocurren.`;
        },
      },
    });
  };
}

export function isValidCivilDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

export function EsFechaCalendarioValida(
  options?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'esFechaCalendarioValida',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: isValidCivilDate,
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} debe ser una fecha calendario válida en formato YYYY-MM-DD.`;
        },
      },
    });
  };
}

/**
 * Decorador compuesto para las fechas de evento de los 4 DTOs reproductivos.
 *
 * Exige el formato exacto YYYY-MM-DD. `@IsDateString()` sin opciones aceptaba
 * cualquier ISO-8601, incluido `2026-09-16T14:30:00.000Z`, aunque las columnas
 * de la base son de tipo `date` y descartan la hora igual.
 */
export function EsFechaDeEvento(nombreLegible: string) {
  return applyDecorators(
    IsNotEmpty({ message: `La fecha ${nombreLegible} es requerida` }),
    Matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: `La fecha ${nombreLegible} debe tener formato YYYY-MM-DD`,
    }),
    EsFechaCalendarioValida({
      message: `La fecha ${nombreLegible} debe existir en el calendario`,
    }),
    EsFechaNoFutura({
      message: `La fecha ${nombreLegible} no puede ser futura`,
    }),
  );
}
