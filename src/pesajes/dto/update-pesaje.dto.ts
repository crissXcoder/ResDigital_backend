import { PartialType } from '@nestjs/mapped-types';
import { CreatePesajeDto } from './create-pesaje.dto.js';

export class UpdatePesajeDto extends PartialType(CreatePesajeDto) {}
