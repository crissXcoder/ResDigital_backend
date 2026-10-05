import { IsOptional, IsString, IsBooleanString } from 'class-validator';

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
}
