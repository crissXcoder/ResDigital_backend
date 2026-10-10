import { describe, expect, it } from 'vitest';
import { validarCompatibilidadSexo } from './compatibilidad-sexo.js';

describe('validarCompatibilidadSexo', () => {
  it.each([
    ['Mastitis clínica', 'Ubre'],
    ['Mastitis subclínica', null],
    ['Metritis/Endometritis', 'Reproductivo'],
    ['Retención placentaria', 'Reproductivo'],
  ])('rechaza "%s" para un macho', (diagnostico, categoria) => {
    expect(
      validarCompatibilidadSexo({
        sexo: 'Macho',
        diagnostico,
        categoriaPadecimiento: categoria,
      }),
    ).toBe(`El diagnóstico '${diagnostico}' solo aplica a hembras.`);
  });

  it('rechaza la vía intramamaria para un macho, venga del formulario o del catálogo', () => {
    const base = { sexo: 'Macho', diagnostico: 'Neumonía' };
    expect(validarCompatibilidadSexo({ ...base, via: 'Intramamaria' })).toBe(
      'La vía intramamaria solo aplica a hembras.',
    );
    expect(
      validarCompatibilidadSexo({ ...base, viaMedicamento: 'Intramamaria' }),
    ).toBe('La vía intramamaria solo aplica a hembras.');
  });

  it('acepta diagnósticos de ambos sexos para un macho', () => {
    expect(
      validarCompatibilidadSexo({
        sexo: 'Macho',
        diagnostico: 'Parasitosis interna',
        categoriaPadecimiento: 'Parasitario',
        via: 'Subcutánea',
      }),
    ).toBeNull();
  });

  it('acepta mastitis e intramamaria para una hembra', () => {
    expect(
      validarCompatibilidadSexo({
        sexo: 'Hembra',
        diagnostico: 'Mastitis clínica',
        categoriaPadecimiento: 'Ubre',
        via: 'Intramamaria',
      }),
    ).toBeNull();
  });
});
