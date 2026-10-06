import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

/**
 * Entidad TypeORM para la tabla `catalogo_medicamento`.
 * Almacena el catálogo de medicamentos veterinarios por tenant,
 * incluyendo los días de retiro por defecto para leche y carne.
 */
@Entity({ name: 'catalogo_medicamento' })
export class Medicamento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'nombre_comercial', type: 'text' })
  nombreComercial: string;

  @Column({ name: 'principio_activo', type: 'text', nullable: true })
  principioActivo: string | null;

  @Column({ name: 'via_administracion', type: 'text', nullable: true })
  viaAdministracion: string | null;

  @Column({
    name: 'dias_retiro_leche_default',
    type: 'int',
    default: 0,
  })
  diasRetiroLecheDefault: number;

  @Column({
    name: 'dias_retiro_carne_default',
    type: 'int',
    default: 0,
  })
  diasRetiroCarneDefault: number;
}
