import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PesajesService } from './pesajes.service.js';
import { PesajesController } from './pesajes.controller.js';
import { Pesaje } from './entities/pesaje.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Pesaje, Animal])],
  controllers: [PesajesController],
  providers: [PesajesService],
})
export class PesajesModule {}
