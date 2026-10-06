import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Animal } from '../../animales/entities/animal.entity.js';

export type TipoEvento =
  | 'TRATAMIENTO'
  | 'SERVICIO'
  | 'DIAGNOSTICO'
  | 'PARTO'
  | 'SECADO'
  | 'PESAJE'
  | 'PRODUCCION_LECHE'
  | 'MOVIMIENTO'
  | 'MUERTE';

@Entity('evento')
export class Evento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'animal_id', type: 'uuid' })
  animalId: string;

  @ManyToOne(() => Animal, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'animal_id' })
  animal: Animal;

  @Column({ type: 'text' })
  tipo: TipoEvento;

  @Column({ name: 'fecha_evento', type: 'date' })
  fechaEvento: string;

  @CreateDateColumn({ name: 'fecha_registro', type: 'timestamptz' })
  fechaRegistro: Date;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ type: 'boolean', default: false })
  revertido: boolean;

  @Column({ name: 'evento_corrige_id', type: 'uuid', nullable: true })
  eventoCorrigeId: string | null;

  @ManyToOne(() => Evento, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_corrige_id' })
  eventoCorrige: Evento | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;
}
