import { Entity, PrimaryColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Evento } from '../../eventos/entities/evento.entity.js';

export const TURNOS_ORDENO = ['MANANA', 'TARDE'] as const;
export type TurnoOrdeno = (typeof TURNOS_ORDENO)[number];

export const DISPOSICIONES_LECHE = ['COMERCIALIZABLE', 'DESCARTE'] as const;
export type DisposicionLeche = (typeof DISPOSICIONES_LECHE)[number];

/**
 * Detalle 1:1 de un evento PRODUCCION_LECHE. La fecha, el animal, el usuario y
 * la reversión viven en `evento`. La disposición es una foto tomada al
 * registrar: no se recalcula si después cambia el tratamiento.
 */
@Entity('evento_produccion_leche')
export class EventoProduccionLeche {
  @PrimaryColumn('uuid', { name: 'evento_id' })
  eventoId: string;

  @OneToOne(() => Evento, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_id' })
  evento: Evento;

  @Column({ type: 'text' })
  turno: TurnoOrdeno;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 1,
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) => (value == null ? value : Number(value)),
    },
  })
  litros: number;

  @Column({ type: 'text' })
  disposicion: DisposicionLeche;

  @Column({ name: 'tratamiento_evento_id', type: 'uuid', nullable: true })
  tratamientoEventoId: string | null;
}
