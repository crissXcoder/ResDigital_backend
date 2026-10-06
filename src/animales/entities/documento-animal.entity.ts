import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Animal } from './animal.entity.js';

@Entity('documento_animal')
export class DocumentoAnimal {
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
  tipo: string;

  @Column({ name: 'archivo_url', type: 'text', nullable: true })
  archivoUrl: string | null;

  @Column({ name: 'object_path', type: 'text', nullable: true })
  objectPath: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
