import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class AnularTratamientoDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 500)
  motivo: string;
}
