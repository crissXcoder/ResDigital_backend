import { Entity, PrimaryColumn, Column, OneToOne, ManyToOne, JoinColumn } from 'typeorm';
import { Evento } from '../../eventos/entities/evento.entity.js';

export type MetodoDiagnostico = 'Palpación' | 'Ecografía' | 'PAG';
export type ResultadoDiagnostico = 'Preñada' | 'Vacía';

@Entity('evento_diagnostico')
export class EventoDiagnostico {
  @PrimaryColumn('uuid', { name: 'evento_id' })
  eventoId: string;

  @OneToOne(() => Evento, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_id' })
  evento: Evento;

  @Column({ name: 'evento_servicio_id', type: 'uuid' })
  eventoServicioId: string;

  @ManyToOne(() => Evento, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_servicio_id' })
  eventoServicio: Evento;

  @Column({ type: 'text' })
  metodo: MetodoDiagnostico;

  @Column({ type: 'text' })
  resultado: ResultadoDiagnostico;
}
