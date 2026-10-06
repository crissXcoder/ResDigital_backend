import { IsString, IsNumber, IsOptional, IsDateString, IsInt, Min } from 'class-validator';

export class CreatePotreroDto {
  @IsString()
  nombre: string;

  @IsNumber()
  @Min(0)
  areaHa: number;

  @IsString()
  @IsOptional()
  tipoPasto?: string;

  @IsNumber()
  @Min(0)
  capacidadRecomendadaUaHa: number;

  @IsInt()
  @Min(0)
  diasDescansoRecomendados: number;

  @IsDateString()
  @IsOptional()
  fechaUltimoIngreso?: string;

  @IsString()
  @IsOptional()
  fuenteAgua?: string;

  @IsString()
  @IsOptional()
  notas?: string;

  @IsString()
  @IsOptional()
  estadoManual?: string;
}
