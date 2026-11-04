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

/** Edad mínima civil para servicio o diagnóstico de preñez. */
export const MESES_MINIMOS_PARA_PRENEZ = 15;

/**
 * Categorías de hembra que aún no entran al ciclo reproductivo.
 * Novilla, Vaca y las variantes de lactancia (Vaca en Ordeño, Vaca Seca) sí.
 */
export const CATEGORIAS_HEMBRA_NO_REPRODUCTORA = ['Ternera'] as const;

/**
 * Piso de la ventana de palpación (35–45 días). Un diagnóstico antes de esto
 * no es concluyente; uno posterior sí se acepta.
 */
export const DIAS_MINIMOS_POST_SERVICIO_DIAGNOSTICO = 35;

/**
 * Un parto viable (Normal, Distocia, Cesárea) no puede ocurrir antes de este
 * porcentaje de la gestación de la raza. El aborto no usa este piso.
 */
export const FRACCION_MINIMA_GESTACION_PARTO = 0.6;

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

  /**
   * Suma meses de calendario civil. Si el día no existe en el mes destino
   * (31 ene + 1 mes), usa el último día de ese mes.
   */
  addCalendarMonths(fechaStr: string, months: number): string {
    const normalizada = this.normalizarFechaStr(fechaStr);
    const [year, month, day] = normalizada.split('-').map(Number);
    const index = year * 12 + (month - 1) + months;
    const destinoYear = Math.floor(index / 12);
    const destinoMonth = (index % 12) + 1;
    const ultimoDia = new Date(
      Date.UTC(destinoYear, destinoMonth, 0),
    ).getUTCDate();
    const destinoDay = Math.min(day, ultimoDia);
    return `${destinoYear}-${String(destinoMonth).padStart(2, '0')}-${String(destinoDay).padStart(2, '0')}`;
  }

  /**
   * True si a la fecha del evento la hembra ya cumplió `meses` de edad civil.
   * Sin fecha de nacimiento no se puede afirmar lo contrario: no bloquea.
   */
  cumpleEdadMinimaParaPreniez(
    fechaNacimiento: string | null | undefined,
    fechaEvento: string,
    meses: number = MESES_MINIMOS_PARA_PRENEZ,
  ): boolean {
    if (!fechaNacimiento) return true;
    const nacimiento = this.normalizarFechaStr(fechaNacimiento);
    const evento = this.normalizarFechaStr(fechaEvento);
    return evento >= this.addCalendarMonths(nacimiento, meses);
  }

  mensajeEdadInsuficienteParaPreniez(
    areteInterno: string,
    fechaNacimiento: string,
    fechaEvento: string,
  ): string {
    const aptaDesde = this.addCalendarMonths(
      this.normalizarFechaStr(fechaNacimiento),
      MESES_MINIMOS_PARA_PRENEZ,
    );
    return `La hembra con arete '${areteInterno}' no cumple ${MESES_MINIMOS_PARA_PRENEZ} meses de edad a la fecha ${fechaEvento}. Puede registrar preñez a partir del ${aptaDesde}.`;
  }

  /**
   * Sin categoría no se afirma lo contrario: no bloquea. Ternera sí.
   */
  esCategoriaAptaParaPreniez(categoria: string | null | undefined): boolean {
    if (!categoria) return true;
    return !(CATEGORIAS_HEMBRA_NO_REPRODUCTORA as readonly string[]).includes(
      categoria,
    );
  }

  mensajeCategoriaNoAptaParaPreniez(
    areteInterno: string,
    categoria: string,
  ): string {
    return `La hembra con arete '${areteInterno}' está en categoría '${categoria}'. Una Ternera no registra servicio, diagnóstico de preñez ni parto; debe ser Novilla o Vaca.`;
  }

  fechaMinimaDiagnostico(fechaServicio: string): string {
    return this.addDays(
      this.normalizarFechaStr(fechaServicio),
      DIAS_MINIMOS_POST_SERVICIO_DIAGNOSTICO,
    );
  }

  cumpleDiasMinimosPostServicioDiagnostico(
    fechaServicio: string,
    fechaEvento: string,
  ): boolean {
    return (
      this.normalizarFechaStr(fechaEvento) >=
      this.fechaMinimaDiagnostico(fechaServicio)
    );
  }

  mensajeDiagnosticoPrematuro(
    fechaServicio: string,
    fechaEvento: string,
  ): string {
    const minima = this.fechaMinimaDiagnostico(fechaServicio);
    return `El diagnóstico del ${fechaEvento} es anterior a los ${DIAS_MINIMOS_POST_SERVICIO_DIAGNOSTICO} días post-servicio (mínimo ${minima}). La palpación se registra entre los días 35 y 45.`;
  }

  fechaMinimaPartoViable(
    fechaServicio: string,
    diasGestacion: number,
  ): string {
    const diasMinimos = Math.floor(diasGestacion * FRACCION_MINIMA_GESTACION_PARTO);
    return this.addDays(this.normalizarFechaStr(fechaServicio), diasMinimos);
  }

  cumpleGestacionMinimaParaParto(
    fechaServicio: string,
    fechaEvento: string,
    diasGestacion: number | null | undefined,
  ): boolean {
    if (!diasGestacion || diasGestacion <= 0) return true;
    return (
      this.normalizarFechaStr(fechaEvento) >=
      this.fechaMinimaPartoViable(fechaServicio, diasGestacion)
    );
  }

  mensajePartoPrematuro(
    fechaServicio: string,
    fechaEvento: string,
    diasGestacion: number,
  ): string {
    const minima = this.fechaMinimaPartoViable(fechaServicio, diasGestacion);
    return `El parto del ${fechaEvento} es demasiado temprano para una gestación de ${diasGestacion} días (mínimo ${minima}, 60 % de la gestación de la raza). Un aborto sí puede registrarse antes.`;
  }
}
