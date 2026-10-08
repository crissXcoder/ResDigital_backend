import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { FECHA_CIVIL_REGEX } from '../../tratamientos/dto/create-tratamiento.dto.js';

export class FechaQueryDto {
  @ApiPropertyOptional({
    description: 'Fecha de referencia (YYYY-MM-DD). Por defecto, hoy en la zona horaria de la finca.',
    example: '2026-10-06',
  })
  @Matches(FECHA_CIVIL_REGEX, { message: 'fecha debe tener formato YYYY-MM-DD' })
  @IsDateString()
  @IsOptional()
  fecha?: string;
}

export class RegistrarEventoLactanciaDto {
  @ApiProperty({ description: 'Fecha del evento (YYYY-MM-DD). No puede ser futura.', example: '2026-09-01' })
  @Matches(FECHA_CIVIL_REGEX, { message: 'fecha debe tener formato YYYY-MM-DD' })
  @IsDateString()
  fecha: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  notas?: string;
}

export class EstadoLactanciaDto {
  @ApiProperty({ format: 'uuid' })
  animalId: string;

  @ApiProperty()
  enLactancia: boolean;

  @ApiProperty({ type: String, nullable: true, example: '2026-08-01' })
  fechaInicio: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  eventoInicioId: string | null;

  @ApiProperty({ example: '2026-10-06' })
  fechaReferencia: string;
}

export class HembraEnLactanciaDto {
  @ApiProperty({ format: 'uuid' })
  animalId: string;

  @ApiProperty()
  arete: string;

  @ApiProperty()
  nombre: string;

  @ApiProperty({ example: '2026-08-01' })
  fechaInicio: string;
}

export class EventoLactanciaResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  animalId: string;

  @ApiProperty({ enum: ['INICIO_LACTANCIA', 'FIN_LACTANCIA'] })
  tipo: 'INICIO_LACTANCIA' | 'FIN_LACTANCIA';

  @ApiProperty({ example: '2026-09-01' })
  fecha: string;

  @ApiProperty({ type: String, nullable: true })
  notas: string | null;

  @ApiProperty({ format: 'uuid' })
  usuarioId: string;
}
