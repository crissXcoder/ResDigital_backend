import { describe, expect, it } from 'vitest';
import {
  esRutaDocumentoTratamiento,
  validarDocumentoTratamiento,
} from './documento-tratamiento.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ANIMAL = '22222222-2222-4222-8222-222222222222';
const OTRO = '33333333-3333-4333-8333-333333333333';
const DOC = '44444444-4444-4444-8444-444444444444';

describe('documento del tratamiento', () => {
  it('acepta la ruta privada de la finca y del animal', () => {
    expect(esRutaDocumentoTratamiento(`${TENANT}/${ANIMAL}/tratamiento/${DOC}.pdf`, TENANT, ANIMAL)).toBe(true);
    expect(esRutaDocumentoTratamiento(`${TENANT}/${ANIMAL}/tratamiento/${DOC}.JPG`, TENANT, ANIMAL)).toBe(true);
  });

  it.each([
    [`${OTRO}/${ANIMAL}/tratamiento/${DOC}.pdf`, 'otra finca'],
    [`${TENANT}/${OTRO}/tratamiento/${DOC}.pdf`, 'otro animal'],
    [`${TENANT}/${ANIMAL}/receta/${DOC}.pdf`, 'otra categoría'],
    [`${TENANT}/${ANIMAL}/tratamiento/${DOC}.exe`, 'extensión no permitida'],
    [`${TENANT}/${ANIMAL}/tratamiento/../${DOC}.pdf`, 'ruta con saltos'],
    ['https://x.supabase.co/storage/v1/object/public/documentos/tratamientos/a.pdf', 'URL pública'],
  ])('rechaza %s (%s)', (ruta) => {
    expect(esRutaDocumentoTratamiento(ruta, TENANT, ANIMAL)).toBe(false);
  });

  it('sin documento no hay nada que validar', () => {
    expect(
      validarDocumentoTratamiento({ documento: null, documentoPrevio: null, tenantId: TENANT, animalId: ANIMAL }),
    ).toBeNull();
  });

  it('una URL pública nueva se rechaza, pero la heredada se conserva al corregir', () => {
    const publica = 'https://x.supabase.co/storage/v1/object/public/documentos/tratamientos/a.pdf';
    expect(
      validarDocumentoTratamiento({ documento: publica, documentoPrevio: null, tenantId: TENANT, animalId: ANIMAL }),
    ).toMatch(/almacenamiento privado/);
    expect(
      validarDocumentoTratamiento({ documento: publica, documentoPrevio: publica, tenantId: TENANT, animalId: ANIMAL }),
    ).toBeNull();
  });
});
