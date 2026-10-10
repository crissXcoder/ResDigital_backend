import {
  Entity,
  PrimaryColumn,
  Column,
  OneToOne,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Evento } from '../../eventos/entities/evento.entity.js';
import { Potrero } from './potrero.entity.js';

@Entity('evento_movimiento')
export class EventoMovimiento {
  @PrimaryColumn('uuid', { name: 'evento_id' })
  eventoId: string;

  @OneToOne(() => Evento, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_id' })
  evento: Evento;

  @Column({ name: 'potrero_origen_id', type: 'uuid', nullable: true })
  potreroOrigenId: string | null;

  @ManyToOne(() => Potrero, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'potrero_origen_id' })
  potreroOrigen: Potrero | null;

  @Column({ name: 'potrero_destino_id', type: 'uuid' })
  potreroDestinoId: string;

  @ManyToOne(() => Potrero, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'potrero_destino_id' })
  potreroDestino: Potrero;

  @Column({ type: 'text', nullable: true })
  motivo: string | null;
}
