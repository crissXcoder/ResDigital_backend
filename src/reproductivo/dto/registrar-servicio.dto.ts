import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TipoServicio } from '../entities/evento-servicio.entity.js';
import { EsFechaDeEvento } from './validators/fecha-evento.validator.js';

export class RegistrarServicioDto {
  @ApiProperty({
    description:
      'Fecha en que se realizó el servicio (YYYY-MM-DD). No puede ser futura. Es la base del cálculo de la FPP.',
    example: '2026-09-16',
  })
  @EsFechaDeEvento('del servicio')
  fechaEvento: string;

  @ApiProperty({
    description: 'Tipo de servicio reproductivo',
    enum: ['Inseminación Artificial', 'Monta Natural'],
    example: 'Inseminación Artificial',
  })
  @IsIn(['Inseminación Artificial', 'Monta Natural'], {
    message:
      "El tipo de servicio debe ser 'Inseminación Artificial' o 'Monta Natural'. 'Celo Detectado' es informativo y no genera cronograma.",
  })
  @IsNotEmpty({ message: 'El tipo de servicio es requerido' })
  tipoServicio: TipoServicio;

  @ApiProperty({
    description: 'Nombre o código del toro, o código de pajilla utilizado',
    example: 'Titan (CRC-B-001)',
  })
  @IsString({ message: 'El toro o código de pajilla debe ser texto' })
  @MaxLength(200, {
    message: 'El toro o código de pajilla no puede superar los 200 caracteres',
  })
  @IsNotEmpty({ message: 'El toro o código de pajilla es requerido' })
  toroOPajilla: string;

  @ApiPropertyOptional({
    description: 'Responsable de la inseminación o técnico veterinario',
    example: 'Dr. Roberto García',
  })
  @IsString({ message: 'El responsable debe ser texto' })
  @MaxLength(200, {
    message: 'El responsable no puede superar los 200 caracteres',
  })
  @IsOptional()
  responsable?: string;

  @ApiPropertyOptional({
    description: 'Observaciones adicionales sobre el servicio',
    example:
      'Celo detectado a las 6:00 AM, servicio aplicado 4:00 PM (regla AM/PM)',
  })
  @IsString({ message: 'Las notas deben ser texto' })
  @MaxLength(2000, {
    message: 'Las notas no pueden superar los 2000 caracteres',
  })
  @IsOptional()
  notas?: string;

  @ApiPropertyOptional({
    description:
      'ID del evento anterior que este nuevo evento corrige (marcará el original como revertido = true)',
    example: 'b7a544c0-2ff6-4299-bbca-46fe87588386',
  })
  @IsUUID('4', { message: 'El eventoCorrigeId debe ser un UUID válido' })
  @IsOptional()
  eventoCorrigeId?: string;
}
