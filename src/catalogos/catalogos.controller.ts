import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { EntityManager } from 'typeorm';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CurrentEntityManager } from '../auth/decorators/current-entity-manager.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { CatalogosService } from './catalogos.service.js';

@ApiTags('Catálogos')
@ApiBearerAuth()
@Controller('catalogos')
export class CatalogosController {
  constructor(private readonly catalogosService: CatalogosService) {}

  @Get('razas')
  @ApiOperation({
    summary: 'Catálogo de razas disponible para la finca',
    description:
      'Devuelve las razas globales del sistema más las propias de la finca. Cada raza trae sus días de gestación, que es lo que MOD-03 usa para calcular la FPP.',
  })
  @ApiResponse({
    status: 200,
    description: 'Listado de razas ordenado por nombre',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido o sin claims de tenant',
  })
  findAllRazas(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.catalogosService.findAllRazas(user.tenantId, manager);
  }
}
