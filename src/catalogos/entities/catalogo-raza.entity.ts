import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('catalogo_raza')
export class CatalogoRaza {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Hacemos que sea opcional para que pueda ser global (sin tenant)
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ name: 'dias_gestacion', type: 'int' })
  diasGestacion: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
