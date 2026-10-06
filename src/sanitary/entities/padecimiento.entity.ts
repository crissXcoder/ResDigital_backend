import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Medicamento } from './medicamento.entity.js';

/**
 * Entidad TypeORM para la tabla `catalogo_padecimiento`.
 * Almacena padecimientos/diagnósticos veterinarios comunes por tenant,
 * con referencia opcional al medicamento sugerido.
 */
@Entity({ name: 'catalogo_padecimiento' })
export class Padecimiento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'nombre', type: 'text' })
  nombre: string;

  @Column({ name: 'categoria', type: 'text', nullable: true })
  categoria: string | null;

  @Column({
    name: 'medicamento_sugerido_id',
    type: 'uuid',
    nullable: true,
  })
  medicamentoSugeridoId: string | null;

  @ManyToOne(() => Medicamento, { nullable: true, eager: false })
  @JoinColumn({ name: 'medicamento_sugerido_id' })
  medicamentoSugerido: Medicamento | null;
}
