import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogoRaza } from './entities/catalogo-raza.entity.js';
import { CatalogosController } from './catalogos.controller.js';
import { CatalogosService } from './catalogos.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogoRaza])],
  controllers: [CatalogosController],
  providers: [CatalogosService],
  exports: [TypeOrmModule, CatalogosService],
})
export class CatalogosModule {}
