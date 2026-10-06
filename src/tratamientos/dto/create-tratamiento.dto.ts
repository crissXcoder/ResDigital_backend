import {
  IsString,
  IsUUID,
  IsOptional,
  IsNumber,
  IsDateString,
  Min,
} from 'class-validator';

export class CreateTratamientoDto {
  @IsUUID()
  animalId: string;

  @IsString()
  farmaco: string;

  @IsString()
  dosis: string;

  @IsString()
  @IsOptional()
  via?: string;

  @IsDateString()
  fecha: string;

  @IsString()
  diagnostico: string;

  @IsString()
  @IsOptional()
  veterinario?: string;

  /** Campo legado; se usa como fallback si faltan los duales. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  diasRetiro?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  diasRetiroLeche?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  diasRetiroCarne?: number;

  @IsString()
  @IsOptional()
  documentoUrl?: string;
}
