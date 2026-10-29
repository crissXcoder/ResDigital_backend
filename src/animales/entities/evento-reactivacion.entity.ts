import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Evento } from '../../eventos/entities/evento.entity.js';

@Entity('evento_reactivacion')
export class EventoReactivacion {
  @PrimaryColumn('uuid', { name: 'evento_id' }) eventoId: string;
  @OneToOne(() => Evento, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_id' }) evento: Evento;
  @Column({ name: 'evento_baja_id', type: 'uuid', unique: true }) eventoBajaId: string;
  @Column({ type: 'text' }) modalidad: 'RETORNO' | 'CORRECCION';
  @Column({ type: 'text' }) motivo: string;
  @Column({ name: 'arete_anterior', type: 'text' }) areteAnterior: string;
  @Column({ name: 'arete_nuevo', type: 'text' }) areteNuevo: string;
}
