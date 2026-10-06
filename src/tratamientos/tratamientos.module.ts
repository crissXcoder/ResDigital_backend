import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tratamiento } from './entities/tratamiento.entity.js';
import { TratamientosController } from './tratamientos.controller.js';
import { TratamientosService } from './tratamientos.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Tratamiento])],
  controllers: [TratamientosController],
  providers: [TratamientosService]
})
export class TratamientosModule {}
