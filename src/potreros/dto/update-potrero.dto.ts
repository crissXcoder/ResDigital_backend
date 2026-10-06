import { PartialType } from '@nestjs/mapped-types';
import { CreatePotreroDto } from './create-potrero.dto.js';

export class UpdatePotreroDto extends PartialType(CreatePotreroDto) {}
