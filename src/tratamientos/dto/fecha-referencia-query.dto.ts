import { IsDateString, IsOptional, Matches } from 'class-validator';
import { FECHA_CIVIL_REGEX } from './create-tratamiento.dto.js';

export class FechaReferenciaQueryDto {
  @Matches(FECHA_CIVIL_REGEX, {
    message: 'fechaReferencia debe tener formato YYYY-MM-DD',
  })
  @IsDateString()
  @IsOptional()
  fechaReferencia?: string;
}
