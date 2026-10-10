/**
 * Utilidades de fecha para el backend.
 * Zona horaria oficial del hato: Costa Rica (America/Costa_Rica, UTC-6 sin horario de verano).
 */
export const ZONA_HORARIA_FINCA = 'America/Costa_Rica';

/**
 * Devuelve la fecha civil de hoy en la zona horaria de la finca en formato YYYY-MM-DD.
 */
export function hoyEnZona(zonaHoraria: string = ZONA_HORARIA_FINCA): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
