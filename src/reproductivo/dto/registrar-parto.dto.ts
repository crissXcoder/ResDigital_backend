import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  FACILIDADES_PARTO,
  type FacilidadParto,
} from '../entities/evento-parto.entity.js';
import { EsFechaDeEvento } from './validators/fecha-evento.validator.js';

export class RegistrarPartoDto {
  @ApiProperty({
    description:
      'Fecha en que ocurrió el parto (YYYY-MM-DD). No puede ser futura.',
    example: '2026-09-10',
  })
  @EsFechaDeEvento('del parto')
  fechaEvento: string;

  @ApiPropertyOptional({
    description: 'ID del evento de servicio del cual se originó esta preñez',
    example: 'a0b9432d-cf48-4be7-a2f0-1a76c66cfcb1',
  })
  @IsUUID('4', { message: 'El eventoServicioId debe ser un UUID válido' })
  @IsOptional()
  eventoServicioId?: string;

  @ApiPropertyOptional({
    description:
      'ID del animal registrado como cría recién nacida (si ya fue registrado en el hato)',
    example: 'e1d67412-21d9-482f-870d-f55da282b810',
  })
  @IsUUID('4', { message: 'El criaAnimalId debe ser un UUID válido' })
  @IsOptional()
  criaAnimalId?: string;

  @ApiPropertyOptional({
    description:
      'Desenlace del parto. "Aborto" es el valor que la máquina de estados usa para cerrar la preñez sin cría viable.',
    enum: FACILIDADES_PARTO,
    example: 'Normal',
  })
  @IsIn(FACILIDADES_PARTO, {
    message: `La facilidad del parto debe ser uno de: ${FACILIDADES_PARTO.join(', ')}`,
  })
  @IsOptional()
  facilidadParto?: FacilidadParto;

  @ApiPropertyOptional({
    description: 'Observaciones del parto y estado de la cría y la madre',
    example: 'Cría hembra nacida vigorosa, 38 kg de peso al nacer',
  })
  @IsString({ message: 'Las observaciones deben ser texto' })
  @MaxLength(2000, {
    message: 'Las observaciones no pueden superar los 2000 caracteres',
  })
  @IsOptional()
  observaciones?: string;

  @ApiPropertyOptional({
    description: 'ID de evento anterior si este registro es una corrección',
  })
  @IsUUID('4', { message: 'El eventoCorrigeId debe ser un UUID válido' })
  @IsOptional()
  eventoCorrigeId?: string;
}
