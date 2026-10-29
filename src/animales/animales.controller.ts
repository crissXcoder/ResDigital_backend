import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EntityManager } from 'typeorm';
import { AnimalesService } from './animales.service.js';
import { ReproductiveStateService } from '../reproductivo/services/reproductive-state.service.js';
import { CurrentEntityManager } from '../auth/decorators/current-entity-manager.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { CreateAnimalDto } from './dto/create-animal.dto.js';
import { UpdateAnimalDto } from './dto/update-animal.dto.js';
import { BajaAnimalDto } from './dto/baja-animal.dto.js';
import { ReactivarAnimalDto } from './dto/reactivar-animal.dto.js';
import { CreateDocumentoDto } from './dto/create-documento.dto.js';
import { QueryAnimalDto } from './dto/query-animal.dto.js';
import { DocumentoAnimalResponseDto } from './dto/documento-animal-response.dto.js';
import { ComposicionGeneticaResponseDto } from './dto/composicion-genetica.dto.js';

/**
 * Nota: los handlers reciben `@CurrentUser() user: AuthenticatedUser` en vez de
 * `@Request() req: any`. Con `any` se leía `req.user.tenantId` sin tipo ni
 * comprobación de nulidad: si el guard no llegara a correr, el fallo sería un
 * TypeError en tiempo de ejecución en lugar de un 401 limpio.
 */
@ApiTags('Animales')
@ApiBearerAuth()
@Controller('animales')
export class AnimalesController {
  constructor(private readonly animalesService: AnimalesService, private readonly reproductiveState: ReproductiveStateService) {}

  @Get()
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryAnimalDto,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    const animales = await this.animalesService.findAll(user.tenantId, query, manager);
    const estados = await this.reproductiveState.calcularEstadosBatch(animales.filter((animal) => animal.sexo?.toLowerCase() === 'hembra'), user.tenantId, manager);
    return animales.map((animal) => ({ ...animal, estadoReproductivo: estados.get(animal.id)?.estadoActual ?? null }));
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.findOne(id, user.tenantId, manager);
  }

  @Get(':id/descendencia')
  @ApiOperation({ summary: 'Consultar descendencia registrada del animal en la finca' })
  findDescendencia(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.findDescendencia(id, user.tenantId, manager);
  }

  @Post()
  @Roles('propietario', 'administrador')
  create(
    @Body() createAnimalDto: CreateAnimalDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.create(user.tenantId, createAnimalDto, manager);
  }

  @Patch(':id')
  @Roles('propietario', 'administrador')
  update(
    @Param('id') id: string,
    @Body() updateAnimalDto: UpdateAnimalDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.update(
      id,
      user.tenantId,
      updateAnimalDto,
      manager,
    );
  }

  @Post(':id/baja')
  @Roles('propietario', 'administrador')
  darDeBaja(
    @Param('id') id: string,
    @Body() bajaDto: BajaAnimalDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.darDeBaja(
      id,
      user.tenantId,
      bajaDto,
      manager,
      user.userId,
    );
  }

  @Get(':id/baja')
  @Roles('propietario', 'administrador', 'veterinario', 'peon')
  @ApiOperation({ summary: 'Consultar el evento de baja histórico del animal' })
  @ApiResponse({ status: 200, description: 'Evento histórico de baja del animal' })
  @ApiResponse({ status: 404, description: 'Animal no encontrado o sin registro de baja' })
  getBaja(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.getBajaByAnimal(id, user.tenantId, manager);
  }

  @Get(':id/historial-bajas')
  @ApiOperation({ summary: 'Consultar episodios de baja y retorno sin perder historia' })
  getHistorialBajas(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @CurrentEntityManager() manager: EntityManager) {
    return this.animalesService.getHistorialBajas(id, user.tenantId, manager);
  }

  @Post(':id/reactivar')
  @Roles('propietario', 'administrador')
  @ApiOperation({ summary: 'Reactivar un animal dado de baja si su arete interno está libre' })
  @ApiResponse({ status: 200, description: 'Animal reactivado exitosamente en el hato' })
  @ApiResponse({ status: 404, description: 'Animal no encontrado en esta finca' })
  @ApiResponse({ status: 409, description: 'El animal ya está activo o su arete interno está en uso por otro animal activo' })
  reactivar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactivarAnimalDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.reactivar(id, user.tenantId, user.userId, dto, manager);
  }

  @Get(':id/documentos')
  @ApiOperation({ summary: 'Listar los documentos privados de un animal' })
  @ApiResponse({ status: 200, type: [DocumentoAnimalResponseDto] })
  @ApiResponse({ status: 404, description: 'Animal no encontrado en esta finca' })
  getDocumentos(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.getDocumentos(id, user.tenantId, manager);
  }

  @Post(':id/documentos')
  @Roles('propietario', 'administrador')
  @ApiOperation({ summary: 'Registrar metadatos de un documento ya cargado' })
  @ApiResponse({ status: 201, type: DocumentoAnimalResponseDto })
  @ApiResponse({ status: 400, description: 'Ruta, categoría o archivo inválido' })
  @ApiResponse({ status: 403, description: 'Rol o ruta de archivo no autorizados' })
  @ApiResponse({ status: 404, description: 'Animal no encontrado en esta finca' })
  @ApiResponse({ status: 409, description: 'El objeto ya está registrado' })
  createDocumento(
    @Param('id') id: string,
    @Body() docDto: CreateDocumentoDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.createDocumento(
      id,
      user.tenantId,
      docDto,
      manager,
    );
  }

  @Get(':id/composicion-genetica')
  @Roles('propietario', 'administrador', 'veterinario', 'peon')
  @ApiOperation({
    summary: 'Calcular la composición genética ponderada del animal',
  })
  @ApiResponse({ status: 200, type: ComposicionGeneticaResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Animal no encontrado en esta finca',
  })
  getComposicionGenetica(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.calcularComposicionGenetica(
      id,
      user.tenantId,
      manager,
    );
  }

  @Get(':id/crias')
  @Roles('propietario', 'administrador', 'veterinario', 'peon')
  @ApiOperation({
    summary: 'Listar la descendencia directa registrada (crías) del animal',
  })
  @ApiResponse({ status: 200, description: 'Lista de crías del animal' })
  @ApiResponse({
    status: 404,
    description: 'Animal no encontrado en esta finca',
  })
  getCrias(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.animalesService.obtenerCrias(id, user.tenantId, manager);
  }
}
