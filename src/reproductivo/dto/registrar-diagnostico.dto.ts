import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  MetodoDiagnostico,
  ResultadoDiagnostico,
} from '../entities/evento-diagnostico.entity.js';
import { EsFechaDeEvento } from './validators/fecha-evento.validator.js';

export class RegistrarDiagnosticoDto {
  @ApiProperty({
    description:
      'Fecha en que se realizó el diagnóstico (YYYY-MM-DD). No puede ser futura.',
    example: '2026-09-10',
  })
  @EsFechaDeEvento('del diagnóstico')
  fechaEvento: string;

  @ApiProperty({
    description:
      'ID del evento de servicio al que corresponde este diagnóstico',
    example: 'a0b9432d-cf48-4be7-a2f0-1a76c66cfcb1',
  })
  @IsUUID('4', { message: 'El eventoServicioId debe ser un UUID válido' })
  @IsNotEmpty({ message: 'El eventoServicioId es requerido' })
  eventoServicioId: string;

  @ApiProperty({
    description: 'Método diagnóstico utilizado',
    enum: ['Palpación', 'Ecografía', 'PAG'],
    example: 'Palpación',
  })
  @IsIn(['Palpación', 'Ecografía', 'PAG'], {
    message: "El método debe ser uno de: 'Palpación', 'Ecografía', 'PAG'",
  })
  @IsNotEmpty({ message: 'El método diagnóstico es requerido' })
  metodo: MetodoDiagnostico;

  @ApiProperty({
    description: 'Resultado del diagnóstico de preñez',
    enum: ['Preñada', 'Vacía'],
    example: 'Preñada',
  })
  @IsIn(['Preñada', 'Vacía'], {
    message: "El resultado debe ser 'Preñada' o 'Vacía'",
  })
  @IsNotEmpty({ message: 'El resultado diagnóstico es requerido' })
  resultado: ResultadoDiagnostico;

  @ApiPropertyOptional({
    description: 'Notas o comentarios del veterinario sobre el diagnóstico',
    example: 'Cuerpo lúteo palpable en cuerno derecho, ~40 días de desarrollo',
  })
  @IsString({ message: 'Las notas deben ser texto' })
  @MaxLength(2000, {
    message: 'Las notas no pueden superar los 2000 caracteres',
  })
  @IsOptional()
  notas?: string;

  @ApiPropertyOptional({
    description: 'ID de evento anterior si este diagnóstico es una corrección',
  })
  @IsUUID('4', { message: 'El eventoCorrigeId debe ser un UUID válido' })
  @IsOptional()
  eventoCorrigeId?: string;
}
