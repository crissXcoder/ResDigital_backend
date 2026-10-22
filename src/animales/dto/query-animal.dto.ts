import { IsOptional, IsString, IsBooleanString, IsUUID } from 'class-validator';

export class QueryAnimalDto {
  @IsOptional()
  @IsBooleanString()
  activo?: string;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsString()
  arete?: string;

  @IsOptional()
  @IsString()
  buscar?: string;

  @IsOptional()
  @IsString()
  sexo?: string;

  @IsOptional()
  @IsUUID()
  potreroId?: string;

  @IsOptional()
  @IsUUID()
  razaId?: string;
}
