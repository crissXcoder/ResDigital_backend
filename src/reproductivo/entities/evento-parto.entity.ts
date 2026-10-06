import {
  Entity,
  PrimaryColumn,
  Column,
  OneToOne,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Evento } from '../../eventos/entities/evento.entity.js';
import { Animal } from '../../animales/entities/animal.entity.js';

/**
 * Catálogo cerrado de desenlaces del parto.
 *
 * `Aborto` no es una "facilidad" en sentido estricto, pero comparte el campo
 * porque es el desenlace que cierra el ciclo de la misma forma. La máquina de
 * estados lo usa para la rama `Preñada → Vacía` por aborto que define
 * MOD-03-Reproductivo.md; por eso el valor tiene que ser exacto y no texto
 * libre. La restricción vive también en la base
 * (evento_parto_facilidad_parto_check).
 */
export const FACILIDADES_PARTO = [
  'Normal',
  'Distocia',
  'Cesárea',
  'Aborto',
] as const;

export type FacilidadParto = (typeof FACILIDADES_PARTO)[number];

@Entity('evento_parto')
export class EventoParto {
  @PrimaryColumn('uuid', { name: 'evento_id' })
  eventoId: string;

  @OneToOne(() => Evento, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_id' })
  evento: Evento;

  @Column({ name: 'evento_servicio_id', type: 'uuid', nullable: true })
  eventoServicioId: string | null;

  @ManyToOne(() => Evento, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'evento_servicio_id' })
  eventoServicio: Evento | null;

  @Column({ name: 'cria_animal_id', type: 'uuid', nullable: true })
  criaAnimalId: string | null;

  @ManyToOne(() => Animal, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cria_animal_id' })
  criaAnimal: Animal | null;

  @Column({ name: 'facilidad_parto', type: 'text', nullable: true })
  facilidadParto: FacilidadParto | null;

  @Column({ type: 'text', nullable: true })
  observaciones: string | null;
}
