import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Animal } from './entities/animal.entity.js';
import { DocumentoAnimal } from './entities/documento-animal.entity.js';
import { AnimalesController } from './animales.controller.js';
import { AnimalesService } from './animales.service.js';
import { AnimalDocumentStorageService } from './animal-document-storage.service.js';

import { Evento } from '../eventos/entities/evento.entity.js';
import { EventoBaja } from './entities/evento-baja.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Animal, DocumentoAnimal, Evento, EventoBaja])],
  controllers: [AnimalesController],
  providers: [AnimalesService, AnimalDocumentStorageService],
  exports: [TypeOrmModule, AnimalesService],
})
export class AnimalesModule {}
