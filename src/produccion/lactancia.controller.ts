import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EntityManager } from 'typeorm';
import { CurrentEntityManager } from '../auth/decorators/current-entity-manager.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { LactanciaService } from './lactancia.service.js';
import {
  EstadoLactanciaDto,
  EventoLactanciaResponseDto,
  FechaQueryDto,
  HembraEnLactanciaDto,
  RegistrarEventoLactanciaDto,
} from './dto/lactancia.dto.js';

@ApiTags('Lactancia')
@ApiBearerAuth()
@Controller('lactancia')
export class LactanciaController {
  constructor(private readonly lactanciaService: LactanciaService) {}

  @Get('activas')
  @ApiResponse({ status: 200, type: [HembraEnLactanciaDto] })
  getActivas(
    @Query() query: FechaQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.lactanciaService.getActivas(user.tenantId, manager, query.fecha);
  }

  @Get('animal/:animalId')
  @ApiResponse({ status: 200, type: EstadoLactanciaDto })
  getEstado(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Query() query: FechaQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.lactanciaService.getEstado(
      user.tenantId,
      animalId,
      manager,
      query.fecha,
    );
  }

  @Post('animal/:animalId/inicio')
  @Roles('propietario', 'administrador')
  @ApiResponse({ status: 201, type: EventoLactanciaResponseDto })
  registrarInicio(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Body() dto: RegistrarEventoLactanciaDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.lactanciaService.registrarInicio(
      user.tenantId,
      user.userId,
      animalId,
      dto,
      manager,
    );
  }

  @Post('animal/:animalId/fin')
  @Roles('propietario', 'administrador')
  @ApiResponse({ status: 201, type: EventoLactanciaResponseDto })
  registrarFin(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Body() dto: RegistrarEventoLactanciaDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.lactanciaService.registrarFin(
      user.tenantId,
      user.userId,
      animalId,
      dto,
      manager,
    );
  }
}
