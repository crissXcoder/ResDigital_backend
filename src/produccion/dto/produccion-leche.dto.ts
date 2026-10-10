import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
} from 'class-validator';
import { FECHA_CIVIL_REGEX } from '../../tratamientos/dto/create-tratamiento.dto.js';
import {
  DISPOSICIONES_LECHE,
  TURNOS_ORDENO,
  type DisposicionLeche,
  type TurnoOrdeno,
} from '../entities/evento-produccion-leche.entity.js';

export const MAX_LITROS_TURNO = 60;

export class CreateProduccionLecheDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  animalId: string;

  @ApiProperty({ description: 'Fecha del ordeño (YYYY-MM-DD). No puede ser futura.', example: '2026-10-06' })
  @Matches(FECHA_CIVIL_REGEX, { message: 'fecha debe tener formato YYYY-MM-DD' })
  @IsDateString()
  fecha: string;

  @ApiProperty({ enum: TURNOS_ORDENO })
  @IsIn([...TURNOS_ORDENO])
  turno: TurnoOrdeno;

  @ApiProperty({ minimum: 0.1, maximum: MAX_LITROS_TURNO, example: 12.5 })
  @IsNumber({ maxDecimalPlaces: 1 }, { message: 'litros debe ser un número con a lo sumo un decimal' })
  @IsPositive({ message: 'litros debe ser mayor que 0' })
  @Max(MAX_LITROS_TURNO, { message: `litros no puede superar ${MAX_LITROS_TURNO} por turno` })
  litros: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  notas?: string;
}

export class AnularProduccionDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 500)
  motivo: string;
}

export class ResumenProduccionQueryDto {
  @ApiPropertyOptional({ description: 'Inicio del rango (YYYY-MM-DD). Por defecto, 29 días antes de `hasta`.' })
  @Matches(FECHA_CIVIL_REGEX, { message: 'desde debe tener formato YYYY-MM-DD' })
  @IsDateString()
  @IsOptional()
  desde?: string;

  @ApiPropertyOptional({ description: 'Fin del rango (YYYY-MM-DD). Por defecto, hoy en la zona horaria de la finca.' })
  @Matches(FECHA_CIVIL_REGEX, { message: 'hasta debe tener formato YYYY-MM-DD' })
  @IsDateString()
  @IsOptional()
  hasta?: string;
}

export class ProduccionLecheResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  animalId: string;

  @ApiProperty({ example: '2026-10-06' })
  fecha: string;

  @ApiProperty({ enum: TURNOS_ORDENO })
  turno: TurnoOrdeno;

  @ApiProperty({ example: 12.5 })
  litros: number;

  @ApiProperty({ enum: DISPOSICIONES_LECHE })
  disposicion: DisposicionLeche;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Tratamiento cuyo retiro de leche originó el descarte.' })
  tratamientoEventoId: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-10-09' })
  fechaLiberacionLeche: string | null;

  @ApiProperty()
  revertido: boolean;

  @ApiProperty({ format: 'uuid' })
  usuarioId: string;

  @ApiProperty({ type: String, nullable: true })
  notas: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  fechaRegistro: Date;
}

export class AnulacionProduccionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  eventoAnulacionId: string;

  @ApiProperty()
  motivo: string;
}

export class ResumenProduccionDiaDto {
  @ApiProperty({ example: '2026-10-06' })
  fecha: string;

  @ApiProperty()
  litrosProducidos: number;

  @ApiProperty()
  litrosComercializables: number;

  @ApiProperty()
  litrosDescarte: number;

  @ApiProperty()
  registros: number;
}

export class ResumenProduccionDto {
  @ApiProperty({ example: '2026-09-07' })
  desde: string;

  @ApiProperty({ example: '2026-10-06' })
  hasta: string;

  @ApiProperty()
  litrosProducidos: number;

  @ApiProperty()
  litrosComercializables: number;

  @ApiProperty()
  litrosDescarte: number;

  @ApiProperty()
  registros: number;

  @ApiProperty({ type: [ResumenProduccionDiaDto] })
  porFecha: ResumenProduccionDiaDto[];
}
