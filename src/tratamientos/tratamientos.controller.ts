import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EntityManager } from 'typeorm';
import { TratamientosService } from './tratamientos.service.js';
import { CurrentEntityManager } from '../auth/decorators/current-entity-manager.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { CreateTratamientoDto } from './dto/create-tratamiento.dto.js';
import { CorregirTratamientoDto } from './dto/corregir-tratamiento.dto.js';
import { AnularTratamientoDto } from './dto/anular-tratamiento.dto.js';
import { FechaReferenciaQueryDto } from './dto/fecha-referencia-query.dto.js';

@ApiTags('Tratamientos Sanitarios')
@ApiBearerAuth()
@Controller('tratamientos')
export class TratamientosController {
  constructor(private readonly tratamientosService: TratamientosService) {}

  @Post()
  @Roles('propietario', 'administrador', 'peon', 'veterinario')
  create(
    @Body() createDto: CreateTratamientoDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.tratamientosService.create(
      user.tenantId,
      user.userId,
      createDto,
      manager,
    );
  }

  @Get('retiros-activos')
  getRetirosActivos(
    @Query() query: FechaReferenciaQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.tratamientosService.getRetirosActivos(
      user.tenantId,
      manager,
      query.fechaReferencia,
    );
  }

  @Get('animal/:animalId/estado-sanitario')
  getEstadoSanitario(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Query() query: FechaReferenciaQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.tratamientosService.getEstadoSanitario(
      user.tenantId,
      animalId,
      manager,
      query.fechaReferencia,
    );
  }

  @Get('animal/:animalId')
  findAllByAnimal(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.tratamientosService.findAllByAnimal(
      user.tenantId,
      animalId,
      manager,
    );
  }

  @Post(':id/correccion')
  @Roles('propietario', 'administrador', 'veterinario')
  corregir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorregirTratamientoDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.tratamientosService.corregir(
      user.tenantId,
      user.userId,
      id,
      dto,
      manager,
    );
  }

  @Post(':id/anulacion')
  @HttpCode(200)
  @Roles('propietario', 'administrador', 'veterinario')
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnularTratamientoDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.tratamientosService.anular(
      user.tenantId,
      user.userId,
      id,
      dto,
      manager,
    );
  }
}
