import { expect, it } from 'vitest';
import { validationMessagesEs } from './validation-messages.js';

it('traduce validaciones anidadas sin exponer valores y conserva reglas del dominio', () => {
  expect(validationMessagesEs([{ property: 'filas', children: [{ property: '0', children: [{ property: 'animalId', constraints: { isUuid: 'animalId must be a UUID' }, children: [] }] }] }, { property: 'fecha', constraints: { fechaEvento: 'La fecha no puede ser futura.' } }])).toEqual(['filas.0.animalId: debe ser un UUID válido.', 'La fecha no puede ser futura.']);
});
