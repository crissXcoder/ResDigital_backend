import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FACILIDADES_PARTO } from '../../entities/evento-parto.entity.js';

/**
 * Clases espejo de las interfaces del módulo, usadas solo como superficie HTTP.
 *
 * Por qué existen: `EstadoReproductivoInfo`, `HitoReproductivo` y compañía son
 * `interface` de TypeScript, y las interfaces se borran al compilar. El
 * generador de OpenAPI de Nest trabaja por reflexión en tiempo de ejecución, así
 * que no puede verlas: los 21 `@ApiResponse` del controlador producían esquemas
 * vacíos y cualquier cliente generado desde el OpenAPI recibía `any`.
 *
 * Las interfaces siguen siendo el contrato interno; estas clases solo describen
 * la respuesta para Swagger.
 */

export const TIPOS_HITO = [
  'Palpación',
  'Secado',
  'Aviso Parto',
  'Aviso Parto Urgente',
  'Parto FPP',
] as const;

export class HitoReproductivoDto {
  @ApiProperty({
    enum: TIPOS_HITO,
    description:
      '"Aviso Parto" es FPP-15 y "Aviso Parto Urgente" es FPP-3. Son dos alertas distintas a propósito.',
  })
  tipo: (typeof TIPOS_HITO)[number];

  @ApiProperty({
    example: '2026-10-15',
    description: 'Fecha del hito (YYYY-MM-DD)',
  })
  fecha: string;

  @ApiProperty({
    example: 12,
    description: 'Días desde hoy. Negativo si el hito ya venció.',
  })
  diasRestantes: number;

  @ApiProperty({
    example: false,
    description: 'true solo en el aviso de FPP-3 días',
  })
  urgente: boolean;
}

export class ResumenServicioActivoDto {
  @ApiProperty() eventoId: string;
  @ApiProperty({ example: '2026-09-16' }) fechaServicio: string;
  @ApiProperty({ example: 'Inseminación Artificial' }) tipoServicio: string;
  @ApiProperty({ example: 'Titan (CRC-B-001)' }) toroOPajilla: string;
  @ApiProperty({ type: 'string', nullable: true })
  responsable: string | null;
  @ApiProperty({
    example: '2026-06-24',
    description: 'Fecha probable de parto',
  })
  fpp: string;
  @ApiProperty({ example: '2026-10-26', description: 'Servicio + 40 días' })
  palpacionFecha: string;
  @ApiProperty({ example: '2026-04-25', description: 'FPP - 60 días' })
  secadoFecha: string;
  @ApiProperty({ example: '2026-06-09', description: 'FPP - 15 días' })
  avisoPartoFecha: string;
  @ApiProperty({ example: '2026-06-21', description: 'FPP - 3 días' })
  avisoPartoUrgenteFecha: string;
  @ApiProperty({ type: 'string', nullable: true })
  notas: string | null;
}

export class ResumenDiagnosticoActivoDto {
  @ApiProperty() eventoId: string;
  @ApiProperty({ example: '2026-10-26' }) fecha: string;
  @ApiProperty({ enum: ['Palpación', 'Ecografía', 'PAG'] }) metodo: string;
  @ApiProperty({ enum: ['Preñada', 'Vacía'] }) resultado: 'Preñada' | 'Vacía';
  @ApiProperty() eventoServicioId: string;
}

export class ResumenPartoActivoDto {
  @ApiProperty() eventoId: string;
  @ApiProperty({ example: '2026-06-22' }) fecha: string;
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  criaAnimalId: string | null;
  @ApiProperty({ type: 'string', enum: FACILIDADES_PARTO, nullable: true })
  facilidadParto: string | null;
}

export class ResumenSecadoActivoDto {
  @ApiProperty() eventoId: string;
  @ApiProperty({ example: '2026-04-25' }) fecha: string;
}

export class EstadoReproductivoResponseDto {
  @ApiProperty() animalId: string;
  @ApiProperty({ example: '101' }) areteInterno: string;
  @ApiProperty({ example: 'Hembra' }) sexo: string;
  @ApiPropertyOptional({ example: 'Holstein' }) razaNombre?: string;
  @ApiPropertyOptional({
    example: 281,
    description: 'Días de gestación de la raza; base del cálculo de la FPP',
  })
  diasGestacionRaza?: number;

  @ApiProperty({
    enum: ['Vacía', 'Servida', 'Preñada', 'En Secado'],
    description:
      'Estado derivado del historial de eventos. Nunca se guarda ni se edita a mano.',
  })
  estadoActual: string;

  @ApiPropertyOptional({
    example: 15,
    description:
      'Días transcurridos desde el evento que dejó al animal en este estado',
  })
  diasEnEstado?: number;

  @ApiPropertyOptional({ type: ResumenServicioActivoDto })
  servicioActivo?: ResumenServicioActivoDto;

  @ApiPropertyOptional({ type: ResumenDiagnosticoActivoDto })
  ultimoDiagnostico?: ResumenDiagnosticoActivoDto;

  @ApiPropertyOptional({ type: ResumenPartoActivoDto })
  ultimoParto?: ResumenPartoActivoDto;

  @ApiPropertyOptional({ type: ResumenSecadoActivoDto })
  ultimoSecado?: ResumenSecadoActivoDto;

  @ApiProperty({ type: [HitoReproductivoDto] })
  proximosHitos: HitoReproductivoDto[];

  @ApiProperty({
    type: [String],
    description:
      'Inconsistencias detectadas al derivar el estado, por ejemplo un evento sin su fila de detalle.',
  })
  advertencias: string[];
}

export class ProximoEventoReproductivoDto {
  @ApiProperty() animalId: string;
  @ApiProperty({ example: '101' }) arete: string;
  @ApiProperty({ example: 'Paloma' }) nombre: string;
  @ApiProperty({
    enum: [
      'Palpación',
      'Secado',
      'Aviso Parto',
      'Aviso Parto Urgente',
      'Parto',
    ],
    description: '"Parto FPP" se publica como "Parto" en este feed.',
  })
  tipo: string;
  @ApiProperty({ example: '2026-10-26' }) fecha: string;
  @ApiProperty({ example: 12 }) diasRestantes: number;
  @ApiProperty({ example: false }) urgente: boolean;
}

export class HitosReproductivosDto {
  @ApiProperty({ example: '2026-06-24' }) fpp: string;
  @ApiProperty({ example: '2026-10-26' }) palpacionFecha: string;
  @ApiProperty({ example: '2026-04-25' }) secadoFecha: string;
  @ApiProperty({ example: '2026-06-09' }) avisoPartoFecha: string;
  @ApiProperty({ example: '2026-06-21' }) avisoPartoUrgenteFecha: string;
}
