import {
  Entity,
  PrimaryColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Evento } from '../../eventos/entities/evento.entity.js';

@Entity('evento_baja')
export class EventoBaja {
  @PrimaryColumn('uuid', { name: 'evento_id' })
  eventoId: string;

  @OneToOne(() => Evento, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_id' })
  evento: Evento;

  @Column({ name: 'tipo_baja', type: 'text' })
  tipoBaja: string;

  @Column({ type: 'text', nullable: true })
  motivo: string | null;

  @Column({
    name: 'precio_venta_crc',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  precioVentaCrc: number | null;

  @Column({
    name: 'peso_final_kg',
    type: 'numeric',
    precision: 6,
    scale: 1,
    nullable: true,
  })
  pesoFinalKg: number | null;
}
