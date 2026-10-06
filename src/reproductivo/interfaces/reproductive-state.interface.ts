export interface HitosReproductivos {
  /** Fecha Probable de Parto (YYYY-MM-DD) = fechaServicio + diasGestacion */
  fpp: string;
  /** Fecha recomendada de palpación (YYYY-MM-DD) = fechaServicio + 40 días (ventana 35-45) */
  palpacionFecha: string;
  /** Fecha de secado sugerida (YYYY-MM-DD) = fpp - 60 días */
  secadoFecha: string;
  /** Primer aviso de preparación de parto (YYYY-MM-DD) = fpp - 15 días */
  avisoPartoFecha: string;
  /** Aviso urgente de parto inminente (YYYY-MM-DD) = fpp - 3 días */
  avisoPartoUrgenteFecha: string;
}

export type EstadoReproductivo = 'Vacía' | 'Servida' | 'Preñada' | 'En Secado';

export interface ResumenServicioActivo {
  eventoId: string;
  fechaServicio: string;
  tipoServicio: string;
  toroOPajilla: string;
  responsable?: string | null;
  fpp: string;
  palpacionFecha: string;
  secadoFecha: string;
  avisoPartoFecha: string;
  avisoPartoUrgenteFecha: string;
  notas?: string | null;
}

export interface ResumenDiagnosticoActivo {
  eventoId: string;
  fecha: string;
  metodo: string;
  resultado: 'Preñada' | 'Vacía';
  eventoServicioId: string;
}

export interface ResumenPartoActivo {
  eventoId: string;
  fecha: string;
  criaAnimalId?: string | null;
  facilidadParto?: string | null;
}

export interface ResumenSecadoActivo {
  eventoId: string;
  fecha: string;
}

/**
 * Tipos de hito que la máquina de estados puede emitir.
 *
 * `Aviso Parto` y `Aviso Parto Urgente` son dos hitos distintos a propósito.
 * Reglas-de-Negocio-Ganaderas.md los pide separados: "FPP - 15 días y FPP - 3
 * días (dos alertas separadas, ambas útiles para que el productor prepare el
 * corral de maternidad)". Colapsarlos en uno pierde justamente la señal que
 * distingue "preparate" de "es ya".
 */
export type TipoHitoReproductivo =
  'Palpación' | 'Secado' | 'Aviso Parto' | 'Aviso Parto Urgente' | 'Parto FPP';

export interface HitoReproductivo {
  tipo: TipoHitoReproductivo;
  fecha: string;
  diasRestantes: number;
  /** true solo en el aviso de FPP - 3 días. */
  urgente: boolean;
}

export interface EstadoReproductivoInfo {
  animalId: string;
  areteInterno: string;
  sexo: string;
  razaNombre?: string;
  diasGestacionRaza?: number;
  estadoActual: EstadoReproductivo;
  /** Días transcurridos desde el evento que dejó al animal en el estado actual. */
  diasEnEstado?: number;
  servicioActivo?: ResumenServicioActivo;
  ultimoDiagnostico?: ResumenDiagnosticoActivo;
  ultimoParto?: ResumenPartoActivo;
  ultimoSecado?: ResumenSecadoActivo;
  proximosHitos?: HitoReproductivo[];
  /**
   * Inconsistencias detectadas al derivar el estado (por ejemplo, un evento sin
   * su fila de detalle). Antes estos casos se ignoraban en silencio y producían
   * un estado incorrecto sin ninguna señal.
   */
  advertencias?: string[];
}
