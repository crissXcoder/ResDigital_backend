import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EsFechaDeEvento } from './validators/fecha-evento.validator.js';

export class RegistrarSecadoDto {
  @ApiProperty({
    description:
      'Fecha de la suspensión real del ordeño (YYYY-MM-DD). No puede ser futura; puede diferir de la fecha de secado calculada.',
    example: '2026-08-10',
  })
  @EsFechaDeEvento('del secado')
  fechaEvento: string;

  @ApiPropertyOptional({
    description:
      'Observaciones o tratamiento de sellado/terapia de secado intramamaria aplicada',
    example:
      'Aplicada infusión de secado en los 4 cuartos + sellador de pezones',
  })
  @IsString({ message: 'Las notas deben ser texto' })
  @MaxLength(2000, {
    message: 'Las notas no pueden superar los 2000 caracteres',
  })
  @IsOptional()
  notas?: string;

  @ApiPropertyOptional({
    description: 'ID de evento anterior si este secado es una corrección',
  })
  @IsUUID('4', { message: 'El eventoCorrigeId debe ser un UUID válido' })
  @IsOptional()
  eventoCorrigeId?: string;
}
