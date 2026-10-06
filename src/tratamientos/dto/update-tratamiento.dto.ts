import { PartialType } from '@nestjs/mapped-types';
import { CreateTratamientoDto } from './create-tratamiento.dto.js';

export class UpdateTratamientoDto extends PartialType(CreateTratamientoDto) {}
