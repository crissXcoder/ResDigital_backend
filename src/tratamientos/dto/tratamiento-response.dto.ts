import type { Evento } from '../../eventos/entities/evento.entity.js';
import type { EventoTratamiento } from '../entities/evento-tratamiento.entity.js';

export interface TratamientoResponseDto {
  id: string;
  animalId: string;
  fecha: string;
  fechaUltimaAdministracion: string;
  medicamentoId: string | null;
  farmaco: string;
  padecimientoId: string | null;
  diagnostico: string;
  dosis: string;
  via: string | null;
  veterinario: string | null;
  diasRetiroLeche: number;
  diasRetiroCarne: number;
  fechaLiberacionLeche: string;
  fechaLiberacionCarne: string;
  documentoUrl: string | null;
  usuarioId: string;
  eventoCorrigeId: string | null;
  fechaRegistro: Date;
}

export interface AnimalEnRetiroDto {
  animalId: string;
  arete: string;
  nombre: string;
  fechaLiberacionLeche: string | null;
  fechaLiberacionCarne: string | null;
  diasRestantesLeche: number | null;
  diasRestantesCarne: number | null;
  tratamientoReferencia: {
    id: string;
    farmaco: string;
    fechaAplicacion: string | null;
  } | null;
}

export function toTratamientoResponse(
  evento: Evento,
  detalle: EventoTratamiento,
): TratamientoResponseDto {
  return {
    id: evento.id,
    animalId: evento.animalId,
    fecha: evento.fechaEvento,
    fechaUltimaAdministracion: detalle.fechaUltimaAdministracion,
    medicamentoId: detalle.medicamentoId,
    farmaco: detalle.productoNombre,
    padecimientoId: detalle.padecimientoId,
    diagnostico: detalle.diagnostico,
    dosis: detalle.dosis,
    via: detalle.via,
    veterinario: detalle.veterinario,
    diasRetiroLeche: detalle.diasRetiroLeche,
    diasRetiroCarne: detalle.diasRetiroCarne,
    fechaLiberacionLeche: detalle.fechaLiberacionLeche,
    fechaLiberacionCarne: detalle.fechaLiberacionCarne,
    documentoUrl: detalle.documentoUrl,
    usuarioId: evento.usuarioId,
    eventoCorrigeId: evento.eventoCorrigeId,
    fechaRegistro: evento.fechaRegistro,
  };
}
