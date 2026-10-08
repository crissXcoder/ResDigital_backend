import type { DisposicionLeche } from './entities/evento-produccion-leche.entity.js';

export interface RetiroLecheTratamiento {
  eventoId: string;
  fechaAplicacion: string;
  fechaLiberacionLeche: string;
}

export interface DisposicionResuelta {
  disposicion: DisposicionLeche;
  tratamientoEventoId: string | null;
  fechaLiberacionLeche: string | null;
}

/**
 * La leche de `fecha` es descarte si algún tratamiento aplicado hasta esa fecha
 * libera la leche después de ella. El día de liberación ya es comercializable,
 * igual que en `computeEstadoSanitario`.
 */
export function resolverDisposicion(
  tratamientos: RetiroLecheTratamiento[],
  fecha: string,
): DisposicionResuelta {
  const dia = fecha.slice(0, 10);
  let origen: RetiroLecheTratamiento | null = null;
  for (const t of tratamientos) {
    const aplicacion = t.fechaAplicacion.slice(0, 10);
    const liberacion = t.fechaLiberacionLeche.slice(0, 10);
    if (aplicacion > dia || liberacion <= dia) continue;
    if (!origen || liberacion > origen.fechaLiberacionLeche.slice(0, 10)) {
      origen = t;
    }
  }
  if (!origen) {
    return {
      disposicion: 'COMERCIALIZABLE',
      tratamientoEventoId: null,
      fechaLiberacionLeche: null,
    };
  }
  return {
    disposicion: 'DESCARTE',
    tratamientoEventoId: origen.eventoId,
    fechaLiberacionLeche: origen.fechaLiberacionLeche.slice(0, 10),
  };
}
