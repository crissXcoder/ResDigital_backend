import {
  IsString,
  IsUUID,
  IsOptional,
  IsInt,
  IsDateString,
  IsNotEmpty,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export const FECHA_CIVIL_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const FECHA_CIVIL_MSG = 'debe tener formato YYYY-MM-DD';

/** Datos clínicos del tratamiento; se reutilizan en la corrección. */
export class DatosTratamientoDto {
  @IsUUID()
  @IsOptional()
  medicamentoId?: string;

  /** Nombre libre del producto; obligatorio solo si no se envía `medicamentoId`. */
  @ValidateIf((o: DatosTratamientoDto) => !o.medicamentoId)
  @IsString()
  @IsNotEmpty()
  farmaco?: string;

  @IsUUID()
  @IsOptional()
  padecimientoId?: string;

  /** Diagnóstico libre; obligatorio solo si no se envía `padecimientoId`. */
  @ValidateIf((o: DatosTratamientoDto) => !o.padecimientoId)
  @IsString()
  @IsNotEmpty()
  diagnostico?: string;

  @IsString()
  @IsNotEmpty()
  dosis: string;

  @IsString()
  @IsOptional()
  via?: string;

  @Matches(FECHA_CIVIL_REGEX, { message: `fecha ${FECHA_CIVIL_MSG}` })
  @IsDateString()
  fecha: string;

  @Matches(FECHA_CIVIL_REGEX, {
    message: `fechaUltimaAdministracion ${FECHA_CIVIL_MSG}`,
  })
  @IsDateString()
  @IsOptional()
  fechaUltimaAdministracion?: string;

  @IsString()
  @IsOptional()
  veterinario?: string;

  @IsInt()
  @Min(0)
  @Max(365)
  diasRetiroLeche: number;

  @IsInt()
  @Min(0)
  @Max(365)
  diasRetiroCarne: number;

  @IsString()
  @IsOptional()
  documentoUrl?: string;
}

export class CreateTratamientoDto extends DatosTratamientoDto {
  @IsUUID()
  animalId: string;
}
