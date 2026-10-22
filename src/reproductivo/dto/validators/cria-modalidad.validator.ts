import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * `criaAnimalId` y `nuevaCria` son mutuamente excluyentes. El contrato de
 * inventario ya lo rechaza en runtime; este validador evita llegar al
 * servicio cuando el cuerpo trae las dos modalidades.
 */
export function CriaModalidadesExcluyentes(
  options?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'criaModalidadesExcluyentes',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const obj = args.object as {
            criaAnimalId?: string;
            nuevaCria?: unknown;
          };
          const tieneId =
            typeof obj.criaAnimalId === 'string' && obj.criaAnimalId.length > 0;
          const tieneNueva = obj.nuevaCria != null;
          return !(tieneId && tieneNueva);
        },
        defaultMessage(): string {
          return 'El contrato de cría no permite especificar "criaAnimalId" y "nuevaCria" simultáneamente.';
        },
      },
    });
  };
}
