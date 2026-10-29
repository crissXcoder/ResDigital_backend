import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { FECHA_CIVIL_REGEX } from '../../tratamientos/dto/create-tratamiento.dto.js';

export class ReactivarAnimalDto {
  @ApiProperty({ enum: ['RETORNO', 'CORRECCION'] })
  @IsIn(['RETORNO', 'CORRECCION'])
  modalidad: 'RETORNO' | 'CORRECCION';

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  eventoBajaId: string;

  @ApiProperty({ example: '2026-10-22' })
  @Matches(FECHA_CIVIL_REGEX)
  @IsDateString()
  fechaEvento: string;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(3, 500)
  motivo: string;

  @ApiPropertyOptional({ description: 'Nuevo arete interno si el original ya está asignado.' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  @IsOptional()
  areteInterno?: string;
}
