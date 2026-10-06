import { Entity, PrimaryColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Evento } from '../../eventos/entities/evento.entity.js';

export type TipoServicio = 'Inseminación Artificial' | 'Monta Natural';

@Entity('evento_servicio')
export class EventoServicio {
  @PrimaryColumn('uuid', { name: 'evento_id' })
  eventoId: string;

  @OneToOne(() => Evento, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_id' })
  evento: Evento;

  @Column({ name: 'tipo_servicio', type: 'text' })
  tipoServicio: TipoServicio;

  @Column({ name: 'toro_o_pajilla', type: 'text' })
  toroOPajilla: string;

  @Column({ type: 'text', nullable: true })
  responsable: string | null;

  @Column({ name: 'palpacion_fecha', type: 'date' })
  palpacionFecha: string;

  @Column({ name: 'secado_fecha', type: 'date' })
  secadoFecha: string;

  @Column({ name: 'aviso_parto_fecha', type: 'date' })
  avisoPartoFecha: string;

  @Column({ name: 'aviso_parto_urgente_fecha', type: 'date' })
  avisoPartoUrgenteFecha: string;

  @Column({ type: 'date' })
  fpp: string;
}
