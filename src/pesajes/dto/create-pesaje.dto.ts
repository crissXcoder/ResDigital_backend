import { IsUUID, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class CreatePesajeDto {
  @IsUUID()
  animalId: string;

  @IsDateString()
  fecha: string;

  @IsNumber()
  @IsOptional()
  pesoActualKg?: number;

  @IsNumber()
  @IsOptional()
  lecheMananaL?: number;

  @IsNumber()
  @IsOptional()
  lecheTardeL?: number;
}
