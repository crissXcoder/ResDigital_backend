import { Injectable, BadRequestException } from '@nestjs/common';
import type { HitosReproductivos } from '../interfaces/reproductive-state.interface.js';

/** Zona horaria de la finca. Costa Rica es UTC−6 y no aplica horario de verano. */
export const ZONA_HORARIA_FINCA = 'America/Costa_Rica';

/**
 * Fecha de hoy en la zona horaria de la finca, como YYYY-MM-DD.
 *
 * Se expone como función suelta, además de método del servicio, porque los
 * validadores de class-validator no pasan por el contenedor de dependencias.
 */
export function hoyEnZona(zonaHoraria: string = ZONA_HORARIA_FINCA): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

@Injectable()
export class ReproductiveCalculationService {
  /**
   * Ventana estándar de palpación rectal (punto medio entre 35 y 45 días post-servicio).
   * Ver Reglas-de-Negocio-Ganaderas.md y MOD-03-Reproductivo.md.
   */
  private readonly DIAS_PALPACION = 40;

  /**
   * Días previos al parto para iniciar el periodo de secado (suspensión del ordeño).
   */
  private readonly DIAS_PREVIOS_SECADO = 60;

  /**
   * Primer aviso de preparación de corral de maternidad (15 días antes de FPP).
   */
  private readonly DIAS_AVISO_PARTO = 15;

  /**
   * Aviso urgente de parto inminente (3 días antes de FPP).
   */
  private readonly DIAS_AVISO_PARTO_URGENTE = 3;

  /**
   * Función pura que calcula los 4 hitos reproductivos a partir de la fecha de servicio
   * y los días de gestación de la raza del animal.
   *
   * @param fechaServicio Fecha en que ocurrió el servicio (Date o string YYYY-MM-DD).
   * @param diasGestacion Días de gestación según catalogo_raza.dias_gestacion.
   * @returns HitosReproductivos con fpp, palpacionFecha, secadoFecha, avisoPartoFecha, avisoPartoUrgenteFecha.
   */
  calcularHitos(
    fechaServicio: Date | string,
    diasGestacion: number,
  ): HitosReproductivos {
    if (
      diasGestacion === null ||
      diasGestacion === undefined ||
      typeof diasGestacion !== 'number' ||
      isNaN(diasGestacion) ||
      diasGestacion <= 0
    ) {
      throw new BadRequestException(
        'Días de gestación inválidos o ausentes. El animal debe contar con una raza válida que especifique dias_gestacion.',
      );
    }

    const fechaBaseStr = this.normalizarFechaStr(fechaServicio);

    // 1. FPP = fechaServicio + catalogo_raza.dias_gestacion
    const fpp = this.addDays(fechaBaseStr, diasGestacion);

    // 2. Palpación = fechaServicio + 40 días (punto medio ventana 35-45)
    const palpacionFecha = this.addDays(fechaBaseStr, this.DIAS_PALPACION);

    // 3. Secado = fpp - 60 días
    const secadoFecha = this.addDays(fpp, -this.DIAS_PREVIOS_SECADO);

    // 4. Aviso parto = fpp - 15 días
    const avisoPartoFecha = this.addDays(fpp, -this.DIAS_AVISO_PARTO);

    // 5. Aviso parto urgente = fpp - 3 días
    const avisoPartoUrgenteFecha = this.addDays(
      fpp,
      -this.DIAS_AVISO_PARTO_URGENTE,
    );

    return {
      fpp,
      palpacionFecha,
      secadoFecha,
      avisoPartoFecha,
      avisoPartoUrgenteFecha,
    };
  }

  /**
   * Fecha de hoy en la zona horaria de la finca, como YYYY-MM-DD.
   *
   * Antes el sistema usaba `new Date().toISOString().slice(0, 10)`, que da el día
   * en UTC. Costa Rica es UTC−6, así que entre las 18:00 y la medianoche local el
   * servidor ya estaba contando el día siguiente: durante seis horas de cada día
   * los `diasRestantes` de todos los hitos salían corridos en uno.
   *
   * `Intl.DateTimeFormat` con locale `en-CA` devuelve directamente el formato
   * YYYY-MM-DD, sin tener que recomponer las partes a mano.
   */
  hoyLocal(zonaHoraria: string = ZONA_HORARIA_FINCA): string {
    return hoyEnZona(zonaHoraria);
  }

  /**
   * Normaliza cualquier entrada Date o string a formato estricto YYYY-MM-DD en UTC
   * para prevenir cualquier desvío por zona horaria.
   */
  normalizarFechaStr(fecha: Date | string): string {
    if (fecha instanceof Date) {
      if (isNaN(fecha.getTime())) {
        throw new BadRequestException('Fecha de servicio inválida.');
      }
      return fecha.toISOString().slice(0, 10);
    }

    if (typeof fecha === 'string') {
      const match = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
      }
      const parsed = new Date(fecha);
      if (isNaN(parsed.getTime())) {
        throw new BadRequestException(`Formato de fecha inválido: '${fecha}'.`);
      }
      return parsed.toISOString().slice(0, 10);
    }

    throw new BadRequestException('La fecha proporcionada no es válida.');
  }

  /**
   * Aritmética de fechas calendario pura basada en UTC (sin corrimiento de huso horario).
   */
  addDays(fechaStr: string, days: number): string {
    const parts = fechaStr.slice(0, 10).split('-').map(Number);
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];

    const utcDate = new Date(Date.UTC(year, month - 1, day));
    utcDate.setUTCDate(utcDate.getUTCDate() + days);

    const y = utcDate.getUTCFullYear();
    const m = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utcDate.getUTCDate()).padStart(2, '0');

    return `${y}-${m}-${d}`;
  }
}
