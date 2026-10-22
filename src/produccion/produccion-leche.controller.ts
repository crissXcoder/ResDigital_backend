import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EntityManager } from 'typeorm';
import { CurrentEntityManager } from '../auth/decorators/current-entity-manager.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { ProduccionLecheService } from './produccion-leche.service.js';
import {
  AnulacionProduccionResponseDto,
  AnularProduccionDto,
  CreateProduccionLecheDto,
  ImportarProduccionLecheLoteDto,
  ImportarLoteResponseDto,
  ProduccionLecheResponseDto,
  ResumenProduccionDto,
  ResumenProduccionQueryDto,
  UpdateProduccionLecheDto,
} from './dto/produccion-leche.dto.js';

@ApiTags('Producción de Leche')
@ApiBearerAuth()
@Controller('produccion-leche')
export class ProduccionLecheController {
  constructor(private readonly produccionService: ProduccionLecheService) {}


  @Post('lote')
  @Roles('propietario', 'administrador', 'peon')
  @ApiResponse({ status: 201, type: ImportarLoteResponseDto })
  importarLote(
    @Body() dto: ImportarProduccionLecheLoteDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.produccionService.importarLote(
      user.tenantId,
      user.userId,
      dto,
      manager,
    );
  }

  @Post()
  @Roles('propietario', 'administrador', 'peon')
  @ApiResponse({ status: 201, type: ProduccionLecheResponseDto })
  create(
    @Body() dto: CreateProduccionLecheDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.produccionService.create(user.tenantId, user.userId, dto, manager);
  }

  @Get('resumen')
  @ApiResponse({ status: 200, type: ResumenProduccionDto })
  resumen(
    @Query() query: ResumenProduccionQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.produccionService.resumen(
      user.tenantId,
      manager,
      query.desde,
      query.hasta,
    );
  }

  @Get('registros')
  @ApiResponse({ status: 200, type: [ProduccionLecheResponseDto] })
  registros(
    @Query() query: ResumenProduccionQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.produccionService.listarRegistros(
      user.tenantId,
      manager,
      query.desde,
      query.hasta,
    );
  }

  @Get('animal/:animalId')
  @ApiResponse({ status: 200, type: [ProduccionLecheResponseDto] })
  findAllByAnimal(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.produccionService.findAllByAnimal(user.tenantId, animalId, manager);
  }

  @Patch(':id')
  @Roles('propietario', 'administrador', 'peon')
  @ApiResponse({ status: 200, type: ProduccionLecheResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProduccionLecheDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.produccionService.update(user.tenantId, id, dto, manager);
  }

  @Post(':id/anulacion')
  @HttpCode(200)
  @Roles('propietario', 'administrador')
  @ApiResponse({ status: 200, type: AnulacionProduccionResponseDto })
  anular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnularProduccionDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.produccionService.anular(user.tenantId, user.userId, id, dto, manager);
  }
}
