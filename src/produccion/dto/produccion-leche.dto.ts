import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { FECHA_CIVIL_REGEX } from '../../tratamientos/dto/create-tratamiento.dto.js';
import {
  DISPOSICIONES_LECHE,
  TURNOS_ORDENO,
  type DisposicionLeche,
  type TurnoOrdeno,
} from '../entities/evento-produccion-leche.entity.js';

export const MAX_LITROS_TURNO = 60;
export const MAX_REGISTROS_LOTE = 200;

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

export class FilaImportarProduccionLecheDto {
  @ApiProperty({ description: 'Fecha del ordeño (YYYY-MM-DD)', example: '2026-10-21' })
  @Matches(FECHA_CIVIL_REGEX, { message: 'fecha debe tener formato YYYY-MM-DD' })
  @IsDateString()
  fecha: string;

  @ApiProperty({ enum: TURNOS_ORDENO, example: 'MANANA' })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      const v = value.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (v === 'MANANA') return 'MANANA';
      if (v === 'TARDE') return 'TARDE';
    }
    return value;
  })
  @IsIn([...TURNOS_ORDENO])
  turno: TurnoOrdeno;

  @ApiProperty({ description: 'Arete interno del animal activo', example: '101' })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/^#/, '').trim() : value,
  )
  areteInterno: string;

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

export class ImportarProduccionLecheLoteDto {
  @ApiProperty({
    type: [FilaImportarProduccionLecheDto],
    description: `Lista de registros a importar (máximo ${MAX_REGISTROS_LOTE})`,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'El lote debe contener al menos un registro' })
  @ArrayMaxSize(MAX_REGISTROS_LOTE, {
    message: `El lote no puede superar ${MAX_REGISTROS_LOTE} registros`,
  })
  @ValidateNested({ each: true })
  @Type(() => FilaImportarProduccionLecheDto)
  filas: FilaImportarProduccionLecheDto[];
}

export class ImportarLoteResponseDto {
  @ApiProperty({ example: 5 })
  totalImportados: number;

  @ApiProperty({ example: 62.5 })
  litrosTotales: number;

  @ApiProperty({ example: 50.0 })
  litrosComercializables: number;

  @ApiProperty({ example: 12.5 })
  litrosDescarte: number;

  @ApiProperty({ type: [ProduccionLecheResponseDto] })
  registros: ProduccionLecheResponseDto[];
}
