import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Evento } from '../eventos/entities/evento.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { Medicamento } from '../sanitary/entities/medicamento.entity.js';
import { Padecimiento } from '../sanitary/entities/padecimiento.entity.js';
import { EventoTratamiento } from './entities/evento-tratamiento.entity.js';
import { TratamientosController } from './tratamientos.controller.js';
import { TratamientosService } from './tratamientos.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Evento,
      EventoTratamiento,
      Animal,
      Medicamento,
      Padecimiento,
    ]),
  ],
  controllers: [TratamientosController],
  providers: [TratamientosService],
})
export class TratamientosModule {}
