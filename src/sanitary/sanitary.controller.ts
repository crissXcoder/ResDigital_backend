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
import { SanitaryService } from './sanitary.service.js';
import type { Medicamento } from './entities/medicamento.entity.js';
import type { Padecimiento } from './entities/padecimiento.entity.js';

/**
 * Controlador para los catálogos sanitarios.
 * Todas las rutas están protegidas por AuthGuard (global) y filtradas
 * automáticamente por el tenant_id del usuario autenticado.
 */
@ApiTags('Catálogos Sanitarios')
@ApiBearerAuth()
@Controller('catalogos')
export class SanitaryController {
  constructor(private readonly sanitaryService: SanitaryService) {}

  /**
   * GET /catalogos/medicamentos
   * Devuelve el catálogo de medicamentos veterinarios del tenant autenticado.
   */
  @Get('medicamentos')
  @ApiOperation({
    summary: 'Obtener catálogo de medicamentos veterinarios del tenant',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido o sin claims de tenant',
  })
  async getMedicamentos(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ): Promise<Medicamento[]> {
    return this.sanitaryService.getMedicamentos(user.tenantId, manager);
  }

  /**
   * GET /catalogos/padecimientos
   * Devuelve el catálogo de padecimientos/diagnósticos del tenant autenticado,
   * incluyendo el medicamento sugerido cuando aplica.
   */
  @Get('padecimientos')
  @ApiOperation({
    summary:
      'Obtener catálogo de padecimientos del tenant con fármaco sugerido',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido o sin claims de tenant',
  })
  async getPadecimientos(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ): Promise<Padecimiento[]> {
    return this.sanitaryService.getPadecimientos(user.tenantId, manager);
  }
}
