import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EntityManager } from 'typeorm';
import { PotrerosService } from './potreros.service.js';
import { CurrentEntityManager } from '../auth/decorators/current-entity-manager.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { CreatePotreroDto } from './dto/create-potrero.dto.js';
import { UpdatePotreroDto } from './dto/update-potrero.dto.js';
import { AsignarAnimalesDto } from './dto/asignar-animales.dto.js';

@ApiTags('Potreros')
@ApiBearerAuth()
@Controller('potreros')
export class PotrerosController {
  constructor(private readonly potrerosService: PotrerosService) {}

  @Post()
  @Roles('propietario', 'administrador')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: CreatePotreroDto,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.potrerosService.create(user.tenantId, data, manager);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.potrerosService.findAll(user.tenantId, manager);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.potrerosService.findOne(id, user.tenantId, manager);
  }

  @Patch(':id')
  @Roles('propietario', 'administrador')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() data: UpdatePotreroDto,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.potrerosService.update(id, user.tenantId, data, manager);
  }

  @Delete(':id')
  @Roles('propietario', 'administrador')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.potrerosService.remove(id, user.tenantId, manager);
  }

  @Post(':id/asignar')
  @Roles('propietario', 'administrador', 'peon')
  asignarAnimales(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AsignarAnimalesDto,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.potrerosService.asignarAnimales(
      id,
      user.tenantId,
      body.animalIds,
      manager,
    );
  }
}
