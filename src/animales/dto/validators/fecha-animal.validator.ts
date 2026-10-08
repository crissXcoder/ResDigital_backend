import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { hoyEnZona } from '../../../common/fechas.js';

/**
 * Validador que rechaza fechas futuras en la zona horaria de la finca.
 * Permite valores nulos/indefinidos si el campo es opcional.
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
          if (value === null || value === undefined || value === '') return true;
          if (typeof value !== 'string') return false;
          return value.slice(0, 10) <= hoyEnZona();
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} no puede ser una fecha futura.`;
        },
      },
    });
  };
}
