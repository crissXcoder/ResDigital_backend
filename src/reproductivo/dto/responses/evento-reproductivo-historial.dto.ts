import { ApiProperty } from '@nestjs/swagger';
import { FACILIDADES_PARTO } from '../../entities/evento-parto.entity.js';
import type { EventoHistoricoReproductivo } from '../../services/reproductive-state.service.js';

/**
 * Una entrada del historial reproductivo de un animal.
 *
 * El detalle se aplana en un solo campo `detalle` cuya forma depende de `tipo`,
 * en vez de exponer cuatro campos de los que tres son siempre nulos.
 */

export class DetalleServicioDto {
  @ApiProperty({ enum: ['Inseminación Artificial', 'Monta Natural'] })
  tipoServicio: string;
  @ApiProperty({ example: 'Titan (CRC-B-001)' }) toroOPajilla: string;
  @ApiProperty({ type: 'string', nullable: true })
  responsable: string | null;
  @ApiProperty({ example: '2026-06-24' }) fpp: string;
  @ApiProperty({ example: '2026-10-26' }) palpacionFecha: string;
  @ApiProperty({ example: '2026-04-25' }) secadoFecha: string;
  @ApiProperty({ example: '2026-06-09' }) avisoPartoFecha: string;
  @ApiProperty({ example: '2026-06-21' }) avisoPartoUrgenteFecha: string;
}

export class DetalleDiagnosticoDto {
  @ApiProperty({ enum: ['Palpación', 'Ecografía', 'PAG'] }) metodo: string;
  @ApiProperty({ enum: ['Preñada', 'Vacía'] }) resultado: string;
  @ApiProperty() eventoServicioId: string;
}

export class DetallePartoDto {
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  eventoServicioId: string | null;
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  criaAnimalId: string | null;
  @ApiProperty({ type: 'string', enum: FACILIDADES_PARTO, nullable: true })
  facilidadParto: string | null;
  @ApiProperty({ type: 'string', nullable: true })
  observaciones: string | null;
}

export class EventoReproductivoHistorialDto {
  @ApiProperty() eventoId: string;

  @ApiProperty({ enum: ['SERVICIO', 'DIAGNOSTICO', 'PARTO', 'SECADO'] })
  tipo: string;

  @ApiProperty({
    example: '2026-09-16',
    description: 'Cuándo ocurrió en la realidad',
  })
  fechaEvento: string;

  @ApiProperty({ description: 'Cuándo se escribió en el sistema' })
  fechaRegistro: Date;

  @ApiProperty() usuarioId: string;

  @ApiProperty({
    example: false,
    description:
      'true si un evento posterior lo corrigió. Los eventos revertidos se incluyen en el historial, marcados: el registro es append-only y una corrección tiene que poder verse.',
  })
  revertido: boolean;

  @ApiProperty({
    type: 'string',
    format: 'uuid',
    nullable: true,
    description: 'Si este evento corrige a otro, el id del corregido.',
  })
  eventoCorrigeId: string | null;

  @ApiProperty({ type: 'string', nullable: true })
  notas: string | null;

  @ApiProperty({
    description:
      'Detalle propio del tipo de evento. SECADO no tiene detalle adicional, por eso puede venir nulo.',
    oneOf: [
      { $ref: '#/components/schemas/DetalleServicioDto' },
      { $ref: '#/components/schemas/DetalleDiagnosticoDto' },
      { $ref: '#/components/schemas/DetallePartoDto' },
    ],
    nullable: true,
  })
  detalle: DetalleServicioDto | DetalleDiagnosticoDto | DetallePartoDto | null;
}

/** Convierte el historial interno a la forma que se publica por HTTP. */
export function aHistorialDto(
  item: EventoHistoricoReproductivo,
): EventoReproductivoHistorialDto {
  const { evento, servicio, diagnostico, parto } = item;

  let detalle:
    DetalleServicioDto | DetalleDiagnosticoDto | DetallePartoDto | null = null;

  if (servicio) {
    detalle = {
      tipoServicio: servicio.tipoServicio,
      toroOPajilla: servicio.toroOPajilla,
      responsable: servicio.responsable,
      fpp: servicio.fpp,
      palpacionFecha: servicio.palpacionFecha,
      secadoFecha: servicio.secadoFecha,
      avisoPartoFecha: servicio.avisoPartoFecha,
      avisoPartoUrgenteFecha: servicio.avisoPartoUrgenteFecha,
    };
  } else if (diagnostico) {
    detalle = {
      metodo: diagnostico.metodo,
      resultado: diagnostico.resultado,
      eventoServicioId: diagnostico.eventoServicioId,
    };
  } else if (parto) {
    detalle = {
      eventoServicioId: parto.eventoServicioId,
      criaAnimalId: parto.criaAnimalId,
      facilidadParto: parto.facilidadParto,
      observaciones: parto.observaciones,
    };
  }

  return {
    eventoId: evento.id,
    tipo: evento.tipo,
    fechaEvento: evento.fechaEvento,
    fechaRegistro: evento.fechaRegistro,
    usuarioId: evento.usuarioId,
    revertido: evento.revertido,
    eventoCorrigeId: evento.eventoCorrigeId,
    notas: evento.notas,
    detalle,
  };
}
