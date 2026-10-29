import type { ValidationError } from 'class-validator';

const MENSAJES: Record<string, string> = {
  whitelistValidation: 'no es un campo permitido', isUuid: 'debe ser un UUID válido',
  isDateString: 'debe ser una fecha válida', isString: 'debe ser texto',
  isNumber: 'debe ser un número válido', isInt: 'debe ser un entero',
  isNotEmpty: 'es obligatorio', isIn: 'debe tener un valor del catálogo permitido',
  isBoolean: 'debe ser verdadero o falso', min: 'está por debajo del mínimo permitido',
  max: 'supera el máximo permitido', maxLength: 'supera la longitud máxima permitida',
  minLength: 'no alcanza la longitud mínima permitida', isArray: 'debe ser una lista',
  arrayMaxSize: 'supera el máximo de elementos permitido', arrayMinSize: 'no alcanza el mínimo de elementos requerido',
  arrayNotEmpty: 'debe contener al menos un elemento', isBooleanString: 'debe ser true o false',
  isEmail: 'debe ser un correo electrónico válido', isPositive: 'debe ser positivo',
  isLength: 'no cumple la longitud permitida', matches: 'no tiene el formato permitido',
  nestedValidation: 'debe contener datos válidos', unknownValue: 'no es un dato válido',
};

export function validationMessagesEs(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    return [
      ...Object.entries(error.constraints ?? {}).map(([key, message]) => MENSAJES[key] ? `${path}: ${MENSAJES[key]}.` : message),
      ...validationMessagesEs(error.children ?? [], path),
    ];
  });
}
