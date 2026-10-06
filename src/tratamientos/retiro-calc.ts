/**
 * Aritmética de fechas calendario pura (UTC) para retiros sanitarios.
 * Misma regla que el frontend y que ReproductiveCalculationService.addDays.
 */
export function addCalendarDays(fechaStr: string, days: number): string {
  const parts = fechaStr.slice(0, 10).split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);

  const y = utcDate.getUTCFullYear();
  const m = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayIsoDate(reference?: Date): string {
  const d = reference ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function diasRestantes(
  fechaLiberacion: string,
  fechaReferencia: string,
): number {
  const lib = fechaLiberacion.slice(0, 10).split('-').map(Number);
  const ref = fechaReferencia.slice(0, 10).split('-').map(Number);
  const libTime = Date.UTC(lib[0] ?? 0, (lib[1] ?? 1) - 1, lib[2] ?? 1);
  const refTime = Date.UTC(ref[0] ?? 0, (ref[1] ?? 1) - 1, ref[2] ?? 1);
  const diff = Math.ceil((libTime - refTime) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

export interface RetirosResueltos {
  diasRetiroLeche: number;
  diasRetiroCarne: number;
  diasRetiro: number;
  fechaLiberacionLeche: string;
  fechaLiberacionCarne: string;
}

/**
 * Resuelve retiros duales con fallback al campo legado diasRetiro.
 */
export function resolveRetiros(input: {
  fecha: string;
  diasRetiroLeche?: number | null;
  diasRetiroCarne?: number | null;
  diasRetiro?: number | null;
}): RetirosResueltos {
  const legacy = input.diasRetiro ?? 0;
  const leche =
    input.diasRetiroLeche != null && !Number.isNaN(input.diasRetiroLeche)
      ? input.diasRetiroLeche
      : legacy;
  const carne =
    input.diasRetiroCarne != null && !Number.isNaN(input.diasRetiroCarne)
      ? input.diasRetiroCarne
      : legacy;
  const safeLeche = Math.max(0, leche);
  const safeCarne = Math.max(0, carne);
  return {
    diasRetiroLeche: safeLeche,
    diasRetiroCarne: safeCarne,
    diasRetiro: Math.max(safeLeche, safeCarne),
    fechaLiberacionLeche: addCalendarDays(input.fecha, safeLeche),
    fechaLiberacionCarne: addCalendarDays(input.fecha, safeCarne),
  };
}

export interface TratamientoRetiroSnapshot {
  id: string;
  farmaco: string;
  fechaLiberacionLeche: string | null;
  fechaLiberacionCarne: string | null;
}

export interface EstadoSanitarioResult {
  animalId: string;
  enRetiro: boolean;
  liberacionLeche: string | null;
  liberacionCarne: string | null;
  diasRestantesLeche: number;
  diasRestantesCarne: number;
  tratamientoReferencia: { id: string; farmaco: string } | null;
}

export function computeEstadoSanitario(
  animalId: string,
  tratamientos: TratamientoRetiroSnapshot[],
  fechaReferencia: string,
): EstadoSanitarioResult {
  let maxLeche: string | null = null;
  let maxCarne: string | null = null;
  let ref: { id: string; farmaco: string; liberacion: string } | null = null;

  for (const t of tratamientos) {
    const libLeche = t.fechaLiberacionLeche?.slice(0, 10) ?? null;
    const libCarne = t.fechaLiberacionCarne?.slice(0, 10) ?? null;

    if (libLeche && libLeche > fechaReferencia) {
      if (!maxLeche || libLeche > maxLeche) maxLeche = libLeche;
    }
    if (libCarne && libCarne > fechaReferencia) {
      if (!maxCarne || libCarne > maxCarne) maxCarne = libCarne;
    }

    const candidatas = [libLeche, libCarne].filter(
      (f): f is string => !!f && f > fechaReferencia,
    );
    for (const liberacion of candidatas) {
      if (!ref || liberacion > ref.liberacion) {
        ref = { id: t.id, farmaco: t.farmaco, liberacion };
      }
    }
  }

  const enRetiro = maxLeche != null || maxCarne != null;

  return {
    animalId,
    enRetiro,
    liberacionLeche: maxLeche,
    liberacionCarne: maxCarne,
    diasRestantesLeche: maxLeche ? diasRestantes(maxLeche, fechaReferencia) : 0,
    diasRestantesCarne: maxCarne ? diasRestantes(maxCarne, fechaReferencia) : 0,
    tratamientoReferencia: ref ? { id: ref.id, farmaco: ref.farmaco } : null,
  };
}
