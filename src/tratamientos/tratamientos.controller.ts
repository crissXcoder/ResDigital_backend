import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EntityManager } from 'typeorm';
import { TratamientosService } from './tratamientos.service.js';
import { CurrentEntityManager } from '../auth/decorators/current-entity-manager.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { CreateTratamientoDto } from './dto/create-tratamiento.dto.js';
import { UpdateTratamientoDto } from './dto/update-tratamiento.dto.js';

@ApiTags('Tratamientos Sanitarios')
@ApiBearerAuth()
@Controller('tratamientos')
export class TratamientosController {
  constructor(private readonly tratamientosService: TratamientosService) {}

  @Post()
  @Roles('propietario', 'administrador', 'veterinario')
  create(
    @Body() createDto: CreateTratamientoDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.tratamientosService.create(user.tenantId, createDto, manager);
  }

  /** Ruta más específica antes de animal/:animalId */
  @Get('animal/:animalId/estado-sanitario')
  getEstadoSanitario(
    @Param('animalId') animalId: string,
    @Query('fechaReferencia') fechaReferencia: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.tratamientosService.getEstadoSanitario(
      user.tenantId,
      animalId,
      manager,
      fechaReferencia,
    );
  }

  @Get('animal/:animalId')
  findAllByAnimal(
    @Param('animalId') animalId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.tratamientosService.findAllByAnimal(
      user.tenantId,
      animalId,
      manager,
    );
  }

  @Put(':id')
  @Roles('propietario', 'administrador', 'veterinario')
  update(
    @Param('id') id: string,
    @Body() updateDto: UpdateTratamientoDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.tratamientosService.update(
      id,
      user.tenantId,
      updateDto,
      manager,
    );
  }
}
