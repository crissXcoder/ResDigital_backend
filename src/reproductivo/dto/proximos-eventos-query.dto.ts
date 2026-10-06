import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DIAS_VENTANA_DEFAULT } from '../services/reproductive.service.js';

/**
 * Query del calendario reproductivo.
 *
 * Antes `diasVentana` se leía como string suelto y se parseaba a mano en el
 * controlador, por fuera del ValidationPipe: no tenía rango ni control de signo.
 * Un valor negativo hacía que el filtro nunca se cumpliera y el calendario
 * saliera vacío sin explicación; uno enorme devolvía el hato completo.
 *
 * El valor por defecto también estaba escrito en tres lugares distintos. Ahora
 * hay una sola constante, compartida con el servicio.
 */
export class ProximosEventosQueryDto {
  @ApiPropertyOptional({
    description:
      'Cuántos días hacia adelante mirar. El feed incluye además los hitos vencidos en los últimos 7 días, porque siguen siendo tareas pendientes.',
    minimum: 1,
    maximum: 365,
    default: DIAS_VENTANA_DEFAULT,
    example: 30,
  })
  @Type(() => Number)
  @IsInt({ message: 'diasVentana debe ser un número entero de días' })
  @Min(1, { message: 'diasVentana debe ser al menos 1' })
  @Max(365, { message: 'diasVentana no puede superar los 365 días' })
  @IsOptional()
  diasVentana: number = DIAS_VENTANA_DEFAULT;
}
