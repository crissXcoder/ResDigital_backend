import { Controller, Get, Post, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EntityManager } from 'typeorm';
import { PesajesService } from './pesajes.service.js';
import { CurrentEntityManager } from '../auth/decorators/current-entity-manager.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { CreatePesajeDto } from './dto/create-pesaje.dto.js';

@ApiTags('Pesajes')
@ApiBearerAuth()
@Controller('pesajes')
export class PesajesController {
  constructor(private readonly pesajesService: PesajesService) {}

  @Post()
  @Roles('propietario', 'administrador', 'peon')
  create(
    @Body() createDto: CreatePesajeDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.pesajesService.create(user.tenantId, createDto, manager);
  }

  @Get('animal/:animalId')
  findAllByAnimal(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.pesajesService.findAllByAnimal(
      user.tenantId,
      animalId,
      manager,
    );
  }
}
