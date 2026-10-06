import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Animal } from '../../animales/entities/animal.entity.js';

@Entity('tratamiento_sanitario')
export class Tratamiento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'animal_id', type: 'uuid' })
  animalId: string;

  @ManyToOne(() => Animal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'animal_id' })
  animal: Animal;

  @Column({ type: 'text' })
  farmaco: string;

  @Column({ type: 'text' })
  dosis: string;

  @Column({ type: 'text', nullable: true })
  via: string;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'text' })
  diagnostico: string;

  @Column({ type: 'text', nullable: true })
  veterinario: string;

  /** Legado: max(leche, carne). Se mantiene por compatibilidad. */
  @Column({ name: 'dias_retiro', type: 'int', default: 0 })
  diasRetiro: number;

  @Column({ name: 'dias_retiro_leche', type: 'int', default: 0 })
  diasRetiroLeche: number;

  @Column({ name: 'dias_retiro_carne', type: 'int', default: 0 })
  diasRetiroCarne: number;

  @Column({ name: 'fecha_liberacion_leche', type: 'date', nullable: true })
  fechaLiberacionLeche: string | null;

  @Column({ name: 'fecha_liberacion_carne', type: 'date', nullable: true })
  fechaLiberacionCarne: string | null;

  @Column({ name: 'documento_url', type: 'text', nullable: true })
  documentoUrl: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
