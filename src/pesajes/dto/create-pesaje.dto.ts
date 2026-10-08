import { IsUUID, IsNumber, IsDateString, IsPositive, Matches, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FECHA_CIVIL_REGEX } from '../../tratamientos/dto/create-tratamiento.dto.js';

export const MAX_PESO_KG = 2000;

export class CreatePesajeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  animalId: string;

  @ApiProperty({ description: 'Fecha del pesaje (YYYY-MM-DD). No puede ser futura.', example: '2026-10-06' })
  @Matches(FECHA_CIVIL_REGEX, { message: 'fecha debe tener formato YYYY-MM-DD' })
  @IsDateString()
  fecha: string;

  @ApiProperty({ minimum: 0.1, maximum: MAX_PESO_KG, example: 485 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @IsPositive({ message: 'pesoActualKg debe ser mayor que 0' })
  @Max(MAX_PESO_KG)
  pesoActualKg: number;
}
