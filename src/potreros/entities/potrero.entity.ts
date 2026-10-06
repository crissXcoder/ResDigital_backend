import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Animal } from '../../animales/entities/animal.entity.js';

@Entity('potrero')
export class Potrero {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ name: 'area_ha', type: 'numeric', precision: 6, scale: 2 })
  areaHa: number;

  @Column({ name: 'tipo_pasto', type: 'text', nullable: true })
  tipoPasto: string | null;

  @Column({ name: 'capacidad_recomendada_ua_ha', type: 'numeric', precision: 4, scale: 2 })
  capacidadRecomendadaUaHa: number;

  @Column({ name: 'dias_descanso_recomendados', type: 'int' })
  diasDescansoRecomendados: number;

  @Column({ name: 'fecha_ultimo_ingreso', type: 'date', nullable: true })
  fechaUltimoIngreso: string | null;

  @Column({ name: 'fuente_agua', type: 'text', nullable: true })
  fuenteAgua: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ name: 'estado_manual', type: 'text', nullable: true })
  estadoManual: string | null; // Ej: 'DISPONIBLE', 'DESCANSO PROGRAMADO'

  @OneToMany(() => Animal, animal => animal.potrero)
  animales: Animal[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
