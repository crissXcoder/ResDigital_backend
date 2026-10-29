import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Evento } from '../eventos/entities/evento.entity.js';
import { EventoServicio } from './entities/evento-servicio.entity.js';
import { EventoDiagnostico } from './entities/evento-diagnostico.entity.js';
import { EventoParto } from './entities/evento-parto.entity.js';
import { EventoSecado } from './entities/evento-secado.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { AnimalesModule } from '../animales/animales.module.js';
import { ReproductiveService } from './services/reproductive.service.js';
import { ReproductiveController } from './reproductive.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReproductiveStateModule } from './reproductive-state.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Evento,
      EventoServicio,
      EventoDiagnostico,
      EventoParto,
      EventoSecado,
      Animal,
    ]),
    AuthModule,
    ReproductiveStateModule,
    AnimalesModule,
  ],
  controllers: [ReproductiveController],
  providers: [
    ReproductiveService,
  ],
  exports: [
    ReproductiveStateModule,
    ReproductiveService,
  ],
})
export class ReproductivoModule {}
