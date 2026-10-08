import {
  IsArray,
  IsUUID,
  ArrayNotEmpty,
  IsOptional,
  IsDateString,
  IsString,
  MaxLength,
} from 'class-validator';
import { EsFechaNoFutura } from '../../animales/dto/validators/fecha-animal.validator.js';

export class AsignarAnimalesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  animalIds: string[];

  @IsOptional()
  @IsDateString()
  @EsFechaNoFutura()
  fecha?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
