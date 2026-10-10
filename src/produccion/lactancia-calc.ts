export const TIPOS_LACTANCIA = [
  'PARTO',
  'SECADO',
  'INICIO_LACTANCIA',
  'FIN_LACTANCIA',
] as const;
export type TipoEventoLactancia = (typeof TIPOS_LACTANCIA)[number];

export interface EventoLactancia {
  id: string;
  tipo: TipoEventoLactancia;
  fechaEvento: string;
  fechaRegistro: Date;
  revertido?: boolean;
  /** Solo para PARTO: un aborto no abre la lactancia. */
  esAborto?: boolean;
}

export interface EstadoLactancia {
  enLactancia: boolean;
  fechaInicio: string | null;
  eventoInicioId: string | null;
}

const NO_LACTANTE: EstadoLactancia = {
  enLactancia: false,
  fechaInicio: null,
  eventoInicioId: null,
};

function abreLactancia(evento: EventoLactancia): boolean {
  if (evento.tipo === 'INICIO_LACTANCIA') return true;
  return evento.tipo === 'PARTO' && !evento.esAborto;
}

function cuenta(evento: EventoLactancia): boolean {
  if (evento.revertido) return false;
  return evento.tipo !== 'PARTO' || !evento.esAborto;
}

function comparar(a: EventoLactancia, b: EventoLactancia): number {
  if (a.fechaEvento !== b.fechaEvento) {
    return a.fechaEvento < b.fechaEvento ? -1 : 1;
  }
  const registro = a.fechaRegistro.getTime() - b.fechaRegistro.getTime();
  if (registro !== 0) return registro;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Estado de lactancia a una fecha: lo decide el último evento de apertura
 * (parto no aborto, inicio) o cierre (secado, fin) con fecha <= referencia.
 */
export function derivarLactancia(
  eventos: EventoLactancia[],
  fechaReferencia: string,
): EstadoLactancia {
  const ref = fechaReferencia.slice(0, 10);
  let ultimo: EventoLactancia | null = null;
  for (const evento of eventos) {
    if (!cuenta(evento) || evento.fechaEvento.slice(0, 10) > ref) continue;
    if (!ultimo || comparar(evento, ultimo) > 0) ultimo = evento;
  }
  if (!ultimo || !abreLactancia(ultimo)) return NO_LACTANTE;
  return {
    enLactancia: true,
    fechaInicio: ultimo.fechaEvento.slice(0, 10),
    eventoInicioId: ultimo.id,
  };
}
