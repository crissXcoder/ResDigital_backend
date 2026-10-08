import { Entity, PrimaryColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Evento } from '../../eventos/entities/evento.entity.js';

/**
 * Detalle 1:1 de un evento TRATAMIENTO. La fecha de aplicación, el usuario,
 * la corrección y la reversión viven en `evento`.
 */
@Entity('evento_tratamiento')
export class EventoTratamiento {
  @PrimaryColumn('uuid', { name: 'evento_id' })
  eventoId: string;

  @OneToOne(() => Evento, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_id' })
  evento: Evento;

  @Column({ name: 'medicamento_id', type: 'uuid', nullable: true })
  medicamentoId: string | null;

  /** Snapshot del nombre comercial al momento del registro. */
  @Column({ name: 'producto_nombre', type: 'text' })
  productoNombre: string;

  @Column({ name: 'padecimiento_id', type: 'uuid', nullable: true })
  padecimientoId: string | null;

  @Column({ type: 'text' })
  diagnostico: string;

  @Column({ type: 'text' })
  dosis: string;

  @Column({ type: 'text', nullable: true })
  via: string | null;

  @Column({ type: 'text', nullable: true })
  veterinario: string | null;

  @Column({ name: 'fecha_ultima_administracion', type: 'date' })
  fechaUltimaAdministracion: string;

  @Column({ name: 'dias_retiro_leche', type: 'int' })
  diasRetiroLeche: number;

  @Column({ name: 'dias_retiro_carne', type: 'int' })
  diasRetiroCarne: number;

  @Column({ name: 'fecha_liberacion_leche', type: 'date' })
  fechaLiberacionLeche: string;

  @Column({ name: 'fecha_liberacion_carne', type: 'date' })
  fechaLiberacionCarne: string;

  @Column({ name: 'documento_url', type: 'text', nullable: true })
  documentoUrl: string | null;
}
