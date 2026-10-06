/**
 * Compatibilidad entre el sexo del animal y el diagnóstico o producto del
 * tratamiento. El frontend aplica las mismas reglas para ocultar opciones;
 * aquí se rechazan los registros que lleguen por otra vía.
 */
export const CATEGORIAS_SOLO_HEMBRA: readonly string[] = ['Ubre', 'Reproductivo'];

/** Fragmentos de diagnóstico que solo aplican a hembras, también en texto libre. */
export const DIAGNOSTICOS_SOLO_HEMBRA: readonly string[] = ['mastitis', 'metritis'];

/** Fragmentos de diagnóstico que solo aplican a machos (vacío mientras el catálogo no tenga). */
export const DIAGNOSTICOS_SOLO_MACHO: readonly string[] = [];

const VIA_SOLO_HEMBRA = 'Intramamaria';

function contieneAlguno(texto: string, fragmentos: readonly string[]): boolean {
  const normalizado = texto.toLowerCase();
  return fragmentos.some((f) => normalizado.includes(f));
}

export interface CompatibilidadInput {
  sexo: string | null | undefined;
  diagnostico: string;
  categoriaPadecimiento?: string | null;
  via?: string | null;
  viaMedicamento?: string | null;
}

export function validarCompatibilidadSexo(
  input: CompatibilidadInput,
): string | null {
  if (input.sexo === 'Macho') {
    if (
      CATEGORIAS_SOLO_HEMBRA.includes(input.categoriaPadecimiento ?? '') ||
      contieneAlguno(input.diagnostico, DIAGNOSTICOS_SOLO_HEMBRA)
    ) {
      return `El diagnóstico '${input.diagnostico}' solo aplica a hembras.`;
    }
    if (
      input.via === VIA_SOLO_HEMBRA ||
      input.viaMedicamento === VIA_SOLO_HEMBRA
    ) {
      return 'La vía intramamaria solo aplica a hembras.';
    }
  }
  if (
    input.sexo === 'Hembra' &&
    contieneAlguno(input.diagnostico, DIAGNOSTICOS_SOLO_MACHO)
  ) {
    return `El diagnóstico '${input.diagnostico}' solo aplica a machos.`;
  }
  return null;
}
