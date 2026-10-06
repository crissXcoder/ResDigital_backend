import { PartialType } from '@nestjs/mapped-types';
import { CreateAnimalDto } from './create-animal.dto.js';

export class UpdateAnimalDto extends PartialType(CreateAnimalDto) {}
