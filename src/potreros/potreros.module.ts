import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Potrero } from './entities/potrero.entity.js';
import { PotrerosService } from './potreros.service.js';
import { PotrerosController } from './potreros.controller.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { Evento } from '../eventos/entities/evento.entity.js';
import { EventoMovimiento } from './entities/evento-movimiento.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Potrero, Animal, Evento, EventoMovimiento])],
  controllers: [PotrerosController],
  providers: [PotrerosService],
  exports: [PotrerosService],
})
export class PotrerosModule {}
