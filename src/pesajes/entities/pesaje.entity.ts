import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Animal } from '../../animales/entities/animal.entity.js';

@Entity('pesaje')
export class Pesaje {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'animal_id', type: 'uuid' })
  animalId: string;

  @ManyToOne(() => Animal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'animal_id' })
  animal: Animal;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ name: 'peso_actual_kg', type: 'numeric', precision: 6, scale: 1, nullable: true })
  pesoActualKg: number;

  @Column({ name: 'leche_manana_l', type: 'numeric', precision: 5, scale: 1, nullable: true })
  lecheMananaL: number;

  @Column({ name: 'leche_tarde_l', type: 'numeric', precision: 5, scale: 1, nullable: true })
  lecheTardeL: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
