import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SanitaryController } from './sanitary.controller.js';
import { SanitaryService } from './sanitary.service.js';
import { Medicamento } from './entities/medicamento.entity.js';
import { Padecimiento } from './entities/padecimiento.entity.js';

/**
 * El `forFeature` faltaba. Con `autoLoadEntities: true`, TypeORM solo registra
 * las entidades que algún módulo declara, así que `Medicamento` y `Padecimiento`
 * nunca entraban al DataSource y cualquier consulta sobre ellas lanzaba
 * `EntityMetadataNotFoundError`. Ese error quedaba atrapado por el fallback del
 * servicio, de modo que los dos endpoints de catálogo nunca leyeron la base.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Medicamento, Padecimiento])],
  controllers: [SanitaryController],
  providers: [SanitaryService],
  exports: [TypeOrmModule, SanitaryService],
})
export class SanitaryModule {}
