import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Evento } from '../eventos/entities/evento.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { EventoParto } from '../reproductivo/entities/evento-parto.entity.js';
import { EventoTratamiento } from '../tratamientos/entities/evento-tratamiento.entity.js';
import { ReproductivoModule } from '../reproductivo/reproductivo.module.js';
import { EventoProduccionLeche } from './entities/evento-produccion-leche.entity.js';
import { LactanciaService } from './lactancia.service.js';
import { LactanciaController } from './lactancia.controller.js';
import { ProduccionLecheService } from './produccion-leche.service.js';
import { ProduccionLecheController } from './produccion-leche.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Evento,
      EventoProduccionLeche,
      EventoTratamiento,
      EventoParto,
      Animal,
    ]),
    ReproductivoModule,
  ],
  controllers: [ProduccionLecheController, LactanciaController],
  providers: [LactanciaService, ProduccionLecheService],
})
export class ProduccionModule {}
