import { ApiProperty } from '@nestjs/swagger';
import { FACILIDADES_PARTO } from '../../entities/evento-parto.entity.js';
import { HitosReproductivosDto } from './estado-reproductivo.response.dto.js';

export class EventoWriteResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) tenantId: string;
  @ApiProperty({ format: 'uuid' }) animalId: string;
  @ApiProperty({ enum: ['SERVICIO', 'DIAGNOSTICO', 'PARTO', 'SECADO'] })
  tipo: 'SERVICIO' | 'DIAGNOSTICO' | 'PARTO' | 'SECADO';
  @ApiProperty({ type: 'string', format: 'date' }) fechaEvento: string;
  @ApiProperty({ format: 'date-time' }) fechaRegistro: Date;
  @ApiProperty({ format: 'uuid' }) usuarioId: string;
  @ApiProperty() revertido: boolean;
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  eventoCorrigeId: string | null;
  @ApiProperty({ type: 'string', nullable: true }) notas: string | null;
}

export class EventoServicioWriteResponseDto {
  @ApiProperty({ format: 'uuid' }) eventoId: string;
  @ApiProperty({ enum: ['Inseminación Artificial', 'Monta Natural'] })
  tipoServicio: string;
  @ApiProperty() toroOPajilla: string;
  @ApiProperty({ type: 'string', nullable: true }) responsable: string | null;
  @ApiProperty({ type: 'string', format: 'date' }) palpacionFecha: string;
  @ApiProperty({ type: 'string', format: 'date' }) secadoFecha: string;
  @ApiProperty({ type: 'string', format: 'date' }) avisoPartoFecha: string;
  @ApiProperty({ type: 'string', format: 'date' }) avisoPartoUrgenteFecha: string;
  @ApiProperty({ type: 'string', format: 'date' }) fpp: string;
}

export class EventoDiagnosticoWriteResponseDto {
  @ApiProperty({ format: 'uuid' }) eventoId: string;
  @ApiProperty({ format: 'uuid' }) eventoServicioId: string;
  @ApiProperty({ enum: ['Palpación', 'Ecografía', 'PAG'] }) metodo: string;
  @ApiProperty({ enum: ['Preñada', 'Vacía'] }) resultado: string;
}

export class EventoPartoWriteResponseDto {
  @ApiProperty({ format: 'uuid' }) eventoId: string;
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) eventoServicioId: string | null;
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) criaAnimalId: string | null;
  @ApiProperty({ enum: FACILIDADES_PARTO, nullable: true }) facilidadParto: string | null;
  @ApiProperty({ type: 'string', nullable: true }) observaciones: string | null;
}

export class EventoSecadoWriteResponseDto {
  @ApiProperty({ format: 'uuid' }) eventoId: string;
}

export class RegistrarServicioResponseDto {
  @ApiProperty({ type: EventoWriteResponseDto }) evento: EventoWriteResponseDto;
  @ApiProperty({ type: EventoServicioWriteResponseDto }) servicio: EventoServicioWriteResponseDto;
  @ApiProperty({ type: HitosReproductivosDto }) hitos: HitosReproductivosDto;
}

export class RegistrarDiagnosticoResponseDto {
  @ApiProperty({ type: EventoWriteResponseDto }) evento: EventoWriteResponseDto;
  @ApiProperty({ type: EventoDiagnosticoWriteResponseDto }) diagnostico: EventoDiagnosticoWriteResponseDto;
}

export class RegistrarPartoResponseDto {
  @ApiProperty({ type: EventoWriteResponseDto }) evento: EventoWriteResponseDto;
  @ApiProperty({ type: EventoPartoWriteResponseDto }) parto: EventoPartoWriteResponseDto;
}

export class RegistrarSecadoResponseDto {
  @ApiProperty({ type: EventoWriteResponseDto }) evento: EventoWriteResponseDto;
  @ApiProperty({ type: EventoSecadoWriteResponseDto }) secado: EventoSecadoWriteResponseDto;
}
