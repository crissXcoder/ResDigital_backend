import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Potrero } from './entities/potrero.entity.js';
import { PotrerosService } from './potreros.service.js';
import { PotrerosController } from './potreros.controller.js';
import { Animal } from '../animales/entities/animal.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Potrero, Animal])],
  controllers: [PotrerosController],
  providers: [PotrerosService],
  exports: [PotrerosService]
})
export class PotrerosModule {}
