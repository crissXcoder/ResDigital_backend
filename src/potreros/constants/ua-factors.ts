/**
 * Constantes y utilidades para el cálculo agronómico/zootécnico de Unidades Animales (UA).
 *
 * Norma estándar internacional (FAO / INTA / MAG Costa Rica):
 * 1 Unidad Animal (UA) equivale a una vaca adulta de 450 kg de peso vivo con o sin cría.
 *
 * Tarea: POT-T003 — Mejorar cálculo UA configurable (MOD-05).
 */

export const PESO_BASE_UA_KG = 450;

/**
 * Factores UA canónicos por categoría etaria/biológica en caso de que no se
 * disponga del peso vivo real del animal.
 *
 * Coincide estrictamente con `CATEGORIAS_ANIMAL` de `src/animales/dto/create-animal.dto.ts`.
 */
export const FACTORES_UA_POR_CATEGORIA: Readonly<Record<string, number>> = {
  // Toro reproductor adulto (~560 kg)
  Toro: 1.25,
  // Vaca adulta de cría/ordeño estándar (~450 kg)
  Vaca: 1.0,
  // Macho de 2 a 3 años para engorde (~360 kg)
  'Novillo mayor': 0.8,
  // Hembra de reemplazo/servicio (~315 kg)
  Novilla: 0.7,
  // Macho de levante de 1 a 2 años (~270 kg)
  Novillo: 0.6,
  // Cría hembra menor a 1 año (~160 kg)
  Ternera: 0.35,
  // Cría macho menor a 1 año (~160 kg)
  Ternero: 0.35,
};

export const FACTOR_UA_FALLBACK_DEFAULT = 0.5;

export interface UaAnimalCalculada {
  ua: number;
  metodo: 'PESO' | 'CATEGORIA';
}

/**
 * Calcula la Unidad Animal (UA) de un bovino de forma híbrida:
 * 1. Si cuenta con peso vivo real positivo y físicamente plausible (0 < peso <= 2000 kg),
 *    calcula su biomasa exacta: UA = pesoActualKg / 450.
 * 2. Si no tiene peso registrado (o es <= 0), utiliza el factor zootécnico de su categoría.
 * 3. Si la categoría no está catalogada, aplica fallback defensivo seguro (0.50 UA).
 */
export function calcularUaAnimal(animal: {
  categoria?: string | null;
  pesoActualKg?: number | null;
}): UaAnimalCalculada {
  const peso =
    typeof animal.pesoActualKg === 'number'
      ? animal.pesoActualKg
      : animal.pesoActualKg
        ? Number.parseFloat(String(animal.pesoActualKg))
        : null;

  if (peso !== null && !Number.isNaN(peso) && peso > 0 && peso <= 2000) {
    const uaPorPeso = Number((peso / PESO_BASE_UA_KG).toFixed(2));
    return {
      ua: uaPorPeso,
      metodo: 'PESO',
    };
  }

  const categoria = animal.categoria?.trim() || '';
  const factor = FACTORES_UA_POR_CATEGORIA[categoria] ?? FACTOR_UA_FALLBACK_DEFAULT;

  return {
    ua: factor,
    metodo: 'CATEGORIA',
  };
}
