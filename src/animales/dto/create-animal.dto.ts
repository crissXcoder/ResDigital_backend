import {
  IsString,
  IsUUID,
  IsOptional,
  IsIn,
  IsNumber,
  IsDateString,
} from 'class-validator';

/** La base tiene CHECK (sexo IN ('Hembra','Macho')). */
export const SEXOS = ['Hembra', 'Macho'] as const;

/**
 * Categorías del hato. No hay CHECK en la base todavía, pero
 * `PotrerosService.calcularEstadoPotrero` compara contra estos valores exactos
 * para calcular las unidades animal, así que un valor libre rompía el cálculo
 * de carga en silencio.
 */
export const CATEGORIAS_ANIMAL = [
  'Ternero',
  'Ternera',
  'Novillo',
  'Novillo mayor',
  'Novilla',
  'Vaca',
  'Toro',
] as const;

export class CreateAnimalDto {
  @IsString()
  nombre: string;

  @IsString()
  areteInterno: string;

  @IsString()
  @IsOptional()
  numeroOficialDiio?: string;

  // Antes era @IsString(): un valor fuera del catálogo pasaba la validación y
  // reventaba contra el CHECK de Postgres como error 500.
  @IsIn(SEXOS, { message: "El sexo debe ser 'Hembra' o 'Macho'" })
  sexo: (typeof SEXOS)[number];

  @IsUUID()
  razaId: string;

  @IsString()
  @IsOptional()
  razaOtra?: string;

  @IsIn(CATEGORIAS_ANIMAL, {
    message: `La categoría debe ser una de: ${CATEGORIAS_ANIMAL.join(', ')}`,
  })
  categoria: (typeof CATEGORIAS_ANIMAL)[number];

  @IsUUID()
  @IsOptional()
  potreroId?: string;

  @IsDateString()
  @IsOptional()
  fechaNacimiento?: string;

  @IsNumber()
  @IsOptional()
  pesoActualKg?: number;

  @IsString()
  @IsOptional()
  fotoUrl?: string;

  @IsUUID()
  @IsOptional()
  madreId?: string;

  @IsUUID()
  @IsOptional()
  padreId?: string;

  @IsString()
  @IsOptional()
  padreExternoDescripcion?: string;

  // `activo` no se acepta desde el cliente: un alta siempre entra activa, y la
  // baja tiene su propio endpoint (POST /animales/:id/baja) con su DTO y sus
  // reglas. Permitirlo acá dejaba crear un animal ya dado de baja, saltándose
  // el motivo, la fecha y el tipo de baja.

  @IsString()
  @IsOptional()
  origen?: 'Finca' | 'Externa';

  @IsString()
  @IsOptional()
  compradoA?: string;

  @IsDateString()
  @IsOptional()
  fechaCompra?: string;

  @IsNumber()
  @IsOptional()
  valorCompraCrc?: number;

  @IsString()
  @IsOptional()
  numeroGuia?: string;

  @IsString()
  @IsOptional()
  metodoCompra?: 'Sinpe' | 'Depósito' | 'Efectivo' | 'Combinado';

  @IsString({ each: true })
  @IsOptional()
  metodosCombinados?: string[];

  @IsString()
  @IsOptional()
  referenciaPago?: string;
}
