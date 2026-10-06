import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class BajaAnimalDto {
  @IsString()
  tipoBaja: string;

  @IsString()
  @IsOptional()
  motivoBaja?: string;

  @IsDateString()
  fechaBaja: string;

  @IsNumber()
  @IsOptional()
  precioVentaCrc?: number;

  @IsNumber()
  @IsOptional()
  pesoFinalKg?: number;
}
