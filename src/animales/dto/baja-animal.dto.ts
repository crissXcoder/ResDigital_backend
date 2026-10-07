import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsIn,
  Min,
} from 'class-validator';
import { EsFechaNoFutura } from './validators/fecha-animal.validator.js';

export const TIPOS_BAJA = [
  'Venta Comercial',
  'Fallecimiento',
  'Descarte',
  'Traslado',
  'Otro',
] as const;

export class BajaAnimalDto {
  @IsIn(TIPOS_BAJA, {
    message: `El tipo de baja debe ser uno de: ${TIPOS_BAJA.join(', ')}`,
  })
  tipoBaja: (typeof TIPOS_BAJA)[number];

  @IsString()
  @IsOptional()
  motivoBaja?: string;

  @IsDateString()
  @EsFechaNoFutura({
    message: 'La fecha de baja no puede ser una fecha futura',
  })
  fechaBaja: string;

  @IsNumber()
  @Min(0, { message: 'El precio de venta no puede ser negativo' })
  @IsOptional()
  precioVentaCrc?: number;

  @IsNumber()
  @Min(0, { message: 'El peso final no puede ser negativo' })
  @IsOptional()
  pesoFinalKg?: number;
}
