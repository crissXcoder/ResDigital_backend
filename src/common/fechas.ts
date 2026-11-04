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

/**
 * Convierte una fecha civil YYYY-MM-DD a DD/MM/YYYY para mensajes dirigidos al
 * usuario. El frontend muestra las fechas en ese formato (es como las pinta un
 * <input type="date">), así que un mensaje de error que cite una fecha en ISO
 * no coincide con lo que el usuario ve en el campo.
 */
export function formatearFechaLegible(fechaIso: string): string {
  const [anio, mes, dia] = fechaIso.slice(0, 10).split('-');
  if (!anio || !mes || !dia) return fechaIso;
  return `${dia}/${mes}/${anio}`;
}
