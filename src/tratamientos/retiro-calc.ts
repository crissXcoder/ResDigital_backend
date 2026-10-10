import { ZONA_HORARIA_FINCA } from '../reproductivo/services/reproductive-calculation.service.js';

/** Máximo de días entre la aplicación y la última administración de un protocolo. */
export const MAX_DIAS_PROTOCOLO = 60;

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

/** Fecha civil de hoy en la zona horaria de la finca, sin depender de la del servidor. */
export function todayIsoDate(reference?: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA_FINCA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference ?? new Date());
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
  fechaUltimaAdministracion: string;
  fechaLiberacionLeche: string;
  fechaLiberacionCarne: string;
}

/** Liberaciones calculadas desde la última administración (por defecto, la aplicación). */
export function resolveRetiros(input: {
  fecha: string;
  fechaUltimaAdministracion?: string | null;
  diasRetiroLeche: number;
  diasRetiroCarne: number;
}): RetirosResueltos {
  const ultima = (input.fechaUltimaAdministracion ?? input.fecha).slice(0, 10);
  return {
    diasRetiroLeche: input.diasRetiroLeche,
    diasRetiroCarne: input.diasRetiroCarne,
    fechaUltimaAdministracion: ultima,
    fechaLiberacionLeche: addCalendarDays(ultima, input.diasRetiroLeche),
    fechaLiberacionCarne: addCalendarDays(ultima, input.diasRetiroCarne),
  };
}

/** Devuelve el motivo de rechazo o null si las fechas son válidas. */
export function validarFechasTratamiento(input: {
  fecha: string;
  fechaUltimaAdministracion?: string | null;
  hoy: string;
}): string | null {
  const fecha = input.fecha.slice(0, 10);
  const ultima = (input.fechaUltimaAdministracion ?? fecha).slice(0, 10);
  if (fecha > input.hoy) {
    return `La fecha de aplicación (${fecha}) no puede ser posterior a hoy (${input.hoy}).`;
  }
  if (ultima < fecha) {
    return 'La fecha de última administración no puede ser anterior a la fecha de aplicación.';
  }
  if (ultima > addCalendarDays(fecha, MAX_DIAS_PROTOCOLO)) {
    return `La fecha de última administración no puede superar en más de ${MAX_DIAS_PROTOCOLO} días a la fecha de aplicación.`;
  }
  return null;
}

export interface TratamientoRetiroSnapshot {
  id: string;
  farmaco: string;
  fechaAplicacion?: string;
  fechaLiberacionLeche: string | null;
  fechaLiberacionCarne: string | null;
}

export interface TratamientoReferencia {
  id: string;
  farmaco: string;
  fechaAplicacion: string | null;
}

export interface EstadoSanitarioResult {
  animalId: string;
  enRetiro: boolean;
  liberacionLeche: string | null;
  liberacionCarne: string | null;
  diasRestantesLeche: number;
  diasRestantesCarne: number;
  tratamientoReferencia: TratamientoReferencia | null;
}

export function computeEstadoSanitario(
  animalId: string,
  tratamientos: TratamientoRetiroSnapshot[],
  fechaReferencia: string,
): EstadoSanitarioResult {
  let maxLeche: string | null = null;
  let maxCarne: string | null = null;
  let ref: (TratamientoReferencia & { liberacion: string }) | null = null;

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
        ref = {
          id: t.id,
          farmaco: t.farmaco,
          fechaAplicacion: t.fechaAplicacion?.slice(0, 10) ?? null,
          liberacion,
        };
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
    tratamientoReferencia: ref
      ? { id: ref.id, farmaco: ref.farmaco, fechaAplicacion: ref.fechaAplicacion }
      : null,
  };
}
